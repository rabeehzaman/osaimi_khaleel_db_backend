# Frontend Authentication Implementation Plan

## 🎯 Overview
This document provides step-by-step instructions to implement Supabase authentication with branch-based access control in your Next.js frontend.

**Backend Status:** ✅ COMPLETE (all database migrations applied)
**Frontend Status:** ⏳ PENDING (follow this guide)

---

## 📊 Progress Tracking

- [x] Database setup (Supabase migrations)
- [x] RLS policies created
- [ ] Auth context and hooks
- [ ] Login page
- [ ] Profile page
- [ ] Protected routes (middleware)
- [ ] Layout with AuthProvider
- [ ] Sidebar user menu
- [ ] Branch filter admin support
- [ ] Testing

---

## 📁 Directory Structure

All work should be done in: `/Users/tmr/Desktop/Final Projects/Sweets Dashboard`

```
Sweets Dashboard/
├── src/
│   ├── contexts/
│   │   └── auth-context.tsx          [CREATE NEW]
│   ├── hooks/
│   │   └── use-auth.ts                [CREATE NEW]
│   ├── app/
│   │   ├── login/
│   │   │   └── page.tsx               [CREATE NEW]
│   │   ├── profile/
│   │   │   └── page.tsx               [CREATE NEW]
│   │   └── layout.tsx                 [MODIFY]
│   ├── components/
│   │   ├── dashboard/
│   │   │   ├── app-sidebar.tsx        [MODIFY]
│   │   │   └── branch-filter.tsx      [MODIFY]
│   │   └── ui/
│   │       └── user-menu.tsx          [CREATE NEW]
│   ├── middleware.ts                  [MODIFY]
│   └── lib/
│       └── supabase.ts                [MODIFY - optional]
└── .env.local                         [UPDATE]
```

---

## 🚀 Implementation Steps

### Step 1: Install Required Dependencies

```bash
cd "/Users/tmr/Desktop/Final Projects/Sweets Dashboard"
npm install @supabase/auth-helpers-nextjs
```

---

### Step 2: Create Auth Context

**File:** `src/contexts/auth-context.tsx`

```typescript
"use client"

import React, { createContext, useContext, useEffect, useState } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

interface UserPermissions {
  allowedBranches: string[]
  role: string
  isAdmin: boolean
}

interface AuthContextType {
  user: User | null
  session: Session | null
  permissions: UserPermissions | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  refreshPermissions: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [permissions, setPermissions] = useState<UserPermissions | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchPermissions = async (userId: string) => {
    const { data, error } = await supabase
      .from('user_branch_permissions')
      .select('allowed_branches, role')
      .eq('user_id', userId)
      .single()

    if (error || !data) {
      console.error('Error fetching permissions:', error)
      return null
    }

    return {
      allowedBranches: data.allowed_branches || [],
      role: data.role || 'viewer',
      isAdmin: data.allowed_branches?.includes('*') || false
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)

      if (session?.user) {
        fetchPermissions(session.user.id).then(setPermissions)
      }
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)

      if (session?.user) {
        const perms = await fetchPermissions(session.user.id)
        setPermissions(perms)
      } else {
        setPermissions(null)
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { error }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const refreshPermissions = async () => {
    if (user) {
      const perms = await fetchPermissions(user.id)
      setPermissions(perms)
    }
  }

  const value = {
    user,
    session,
    permissions,
    loading,
    signIn,
    signOut,
    refreshPermissions
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
```

---

### Step 3: Create Auth Hooks

**File:** `src/hooks/use-auth.ts`

```typescript
"use client"

import { useAuth as useAuthContext } from '@/contexts/auth-context'

export const useAuth = useAuthContext

export function useUser() {
  const { user } = useAuthContext()
  return user
}

export function useIsAdmin() {
  const { permissions } = useAuthContext()
  return permissions?.isAdmin || false
}

export function useUserBranches() {
  const { permissions } = useAuthContext()
  return permissions?.allowedBranches || []
}

export function useUserRole() {
  const { permissions } = useAuthContext()
  return permissions?.role || 'viewer'
}
```

---

### Step 4: Create Login Page

**File:** `src/app/login/page.tsx`

```typescript
"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2 } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await signIn(email, password)

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Welcome Back</CardTitle>
          <CardDescription className="text-center">
            Enter your credentials to access the dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="user@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

---

### Step 5: Create Profile Page

**File:** `src/app/profile/page.tsx`

```typescript
"use client"

import { useAuth } from '@/contexts/auth-context'
import { DashboardLayout } from '@/components/dashboard/dashboard-layout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useRouter } from 'next/navigation'

export default function ProfilePage() {
  const { user, permissions, signOut } = useAuth()
  const router = useRouter()

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Profile</h1>

        <Card>
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
            <CardDescription>Your user details and permissions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Email</label>
              <p className="text-lg">{user?.email}</p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Role</label>
              <div className="mt-1">
                <Badge variant={permissions?.isAdmin ? 'destructive' : 'default'}>
                  {permissions?.role || 'viewer'}
                </Badge>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Assigned Branches</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {permissions?.isAdmin ? (
                  <Badge variant="destructive">All Branches (Admin)</Badge>
                ) : (
                  permissions?.allowedBranches.map(branch => (
                    <Badge key={branch} variant="secondary">{branch}</Badge>
                  ))
                )}
              </div>
            </div>

            <div className="pt-4">
              <Button onClick={handleSignOut} variant="destructive">
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
```

---

### Step 6: Update Middleware for Protected Routes

**File:** `src/middleware.ts` (MODIFY)

```typescript
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })

  const { data: { session } } = await supabase.auth.getSession()

  // Public routes
  const publicRoutes = ['/login']
  const isPublicRoute = publicRoutes.some(route => req.nextUrl.pathname.startsWith(route))

  // Redirect to login if not authenticated
  if (!session && !isPublicRoute) {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.searchParams.set('redirectedFrom', req.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // Redirect to home if authenticated and trying to access login
  if (session && req.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)']
}
```

---

### Step 7: Update App Layout

**File:** `src/app/layout.tsx` (ADD AuthProvider)

Find the existing layout and wrap with AuthProvider:

```typescript
import { AuthProvider } from '@/contexts/auth-context'
// ... other existing imports

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {/* Your existing providers */}
          <ThemeProvider>
            <LocaleProvider>
              {children}
            </LocaleProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
```

---

### Step 8: Update Sidebar with User Menu

**File:** `src/components/dashboard/app-sidebar.tsx` (ADD to bottom)

Add these imports:
```typescript
import { useAuth, useIsAdmin } from '@/hooks/use-auth'
import { User, LogOut, Shield } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
```

Add this code to the end of your sidebar component (before the closing `</Sidebar>`):

```typescript
export function AppSidebar() {
  const { user, signOut } = useAuth()
  const isAdmin = useIsAdmin()
  const router = useRouter()

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  return (
    <Sidebar>
      {/* ... your existing sidebar content ... */}

      {/* Add this at the bottom */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton className="w-full">
                  <User className="h-4 w-4" />
                  <span className="truncate">{user?.email}</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{user?.email}</p>
                    {isAdmin && (
                      <Badge variant="destructive" className="w-fit">
                        <Shield className="h-3 w-3 mr-1" />
                        Admin
                      </Badge>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/profile')}>
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
```

---

### Step 9: Update Branch Filter for Admin

**File:** `src/components/dashboard/branch-filter.tsx` (MODIFY)

Add these imports at the top:
```typescript
import { useIsAdmin, useUserBranches } from '@/hooks/use-auth'
import { Badge } from '@/components/ui/badge'
```

Modify the component:
```typescript
export function BranchFilter({ value, onValueChange, className, dateRange }: BranchFilterProps) {
  const { t } = useLocale()
  const isAdmin = useIsAdmin()
  const userBranches = useUserBranches()
  const { branches: activeBranches, loading, error } = useActiveBranches(dateRange)

  // Filter branches to only those user can access
  const accessibleBranches = React.useMemo(() => {
    if (isAdmin) return activeBranches // Admins see all
    return activeBranches.filter(branch => userBranches.includes(branch))
  }, [isAdmin, activeBranches, userBranches])

  return (
    <div className="flex items-center gap-2">
      {isAdmin && (
        <Badge variant="destructive" className="text-xs">
          Admin View
        </Badge>
      )}
      <Select
        value={value || "all"}
        onValueChange={(newValue) => onValueChange(newValue === "all" ? undefined : newValue)}
        disabled={loading}
      >
        <SelectTrigger className={cn("w-[200px] min-h-[44px]", className)}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
          <SelectValue placeholder={loading ? t("filters.loading") : t("filters.all_branches")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            {isAdmin ? "All Branches (Admin)" : t("filters.all_branches")}
          </SelectItem>
          {error ? (
            <SelectItem value="error" disabled>{t("filters.error_loading_branches")}</SelectItem>
          ) : (
            accessibleBranches.map((branch) => (
              <SelectItem key={branch} value={branch}>
                {branch}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  )
}
```

---

### Step 10: Environment Variables

**File:** `.env.local` (ensure these exist)

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

---

## 🧪 Testing Instructions

### 1. Create Test Users in Supabase

Go to Supabase Dashboard → Authentication → Users:

1. **Create Admin User:**
   - Email: `admin@test.com`
   - Password: `TestAdmin123!`
   - Copy the user UUID

2. **Create Regular User:**
   - Email: `user1@test.com`
   - Password: `TestUser123!`
   - Copy the user UUID

### 2. Assign Permissions

In Supabase SQL Editor, run:

```sql
-- Replace UUIDs with actual values from step 1
INSERT INTO user_branch_permissions (user_id, user_email, allowed_branches, role)
VALUES
  ('paste-admin-uuid-here', 'admin@test.com', ARRAY['*'], 'super_admin'),
  ('paste-user1-uuid-here', 'user1@test.com', ARRAY['Branch A'], 'viewer');
```

### 3. Test Login Flow

```bash
# Start dev server
npm run dev

# Test scenarios:
1. Visit http://localhost:3010
2. Should redirect to /login
3. Login as admin@test.com → See all branches
4. Logout
5. Login as user1@test.com → See only Branch A
6. Close browser, reopen → Should still be logged in
```

### 4. Verify RLS is Working

```bash
# Login as user1@test.com
# Open browser DevTools → Network tab
# Check any Supabase query
# Should only return Branch A data
```

### 5. Test Zoho Replication (Backend)

```bash
cd "/Users/tmr/Desktop/Final Projects/osaimi_khaleel_db_backend"
npm run replicate

# Should complete successfully with no RLS errors
# This works because backend uses SERVICE_ROLE_KEY
```

---

## 🐛 Troubleshooting

### Issue: "User not found" after login
**Solution:** Make sure you created the user in Supabase Auth AND added their permissions to `user_branch_permissions` table.

### Issue: Can't see any data after login
**Solution:** Check that:
1. User has branches assigned in `user_branch_permissions`
2. Data exists for those branches in the tables
3. RLS policies are enabled correctly

### Issue: Middleware redirect loop
**Solution:** Check that `/login` is in the `publicRoutes` array in middleware.

### Issue: "Auth must be used within AuthProvider"
**Solution:** Make sure `layout.tsx` wraps with `<AuthProvider>`.

---

## ✅ Completion Checklist

- [ ] Install @supabase/auth-helpers-nextjs
- [ ] Create auth-context.tsx
- [ ] Create use-auth.ts hooks
- [ ] Create login page
- [ ] Create profile page
- [ ] Update middleware
- [ ] Update layout with AuthProvider
- [ ] Update sidebar with user menu
- [ ] Update branch-filter for admin
- [ ] Create test users in Supabase
- [ ] Assign permissions in database
- [ ] Test login as admin
- [ ] Test login as regular user
- [ ] Test session persistence
- [ ] Test logout
- [ ] Verify Zoho replication still works

---

## 📞 Need Help?

If you encounter issues:
1. Check browser console for errors
2. Check Supabase logs in dashboard
3. Verify environment variables are set
4. Check that migrations ran successfully

---

## 🎉 Success Criteria

When complete, you should have:
- ✅ Users can log in with email/password
- ✅ Sessions persist for 60 days
- ✅ Admin users see all branches
- ✅ Regular users see only assigned branches
- ✅ RLS enforces data access at database level
- ✅ Backend replication continues working
- ✅ Professional login/profile pages
- ✅ User menu in sidebar

---

**Backend Status:** ✅ COMPLETE
**Frontend Status:** ⏳ Follow this guide to implement

Good luck! 🚀
