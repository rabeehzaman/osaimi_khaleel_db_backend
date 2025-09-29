require('dotenv').config();
const ZohoBooksClient = require('./src/zoho-books-client');

async function testScheduledWorkflow() {
  const zohoBooksClient = new ZohoBooksClient();

  console.log('🧪 Testing Scheduled Workflow Simulation\n');
  console.log('====================================\n');

  try {
    // Step 1: Check initial state
    console.log('📊 Step 1: Checking initial state...');
    const initialLang = await zohoBooksClient.getCurrentLanguage();
    console.log(`   Current language: ${initialLang}\n`);

    // Step 2: Simulate 11:50 PM - Switch to English
    console.log('🕐 Step 2: Simulating 11:50 PM - Pre-import switch to English...');
    const englishSwitch = await zohoBooksClient.switchToEnglish();
    if (englishSwitch.success) {
      console.log(`   ✅ Successfully switched to English`);
      console.log(`   Previous language: ${englishSwitch.previousLanguage}`);
    } else {
      console.log(`   ❌ Failed to switch to English: ${englishSwitch.message}`);
    }

    // Verify the switch
    const afterEnglishSwitch = await zohoBooksClient.getCurrentLanguage();
    console.log(`   Verified language: ${afterEnglishSwitch}\n`);

    // Step 3: Simulate 12:00 AM - Import would run here
    console.log('🕛 Step 3: Simulating 12:00 AM - Import process...');
    console.log('   [Import would run here with English column names]');
    console.log('   Waiting 3 seconds to simulate import...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 4: Simulate 1:00 AM - Switch back to Arabic
    console.log('🕐 Step 4: Simulating 1:00 AM - Post-import switch to Arabic...');
    const arabicSwitch = await zohoBooksClient.switchToArabic();
    if (arabicSwitch.success) {
      console.log(`   ✅ Successfully switched to Arabic`);
      console.log(`   Message: ${arabicSwitch.message}`);
    } else {
      console.log(`   ❌ Failed to switch to Arabic: ${arabicSwitch.message}`);
    }

    // Verify final state
    const finalLang = await zohoBooksClient.getCurrentLanguage();
    console.log(`   Verified language: ${finalLang}\n`);

    // Summary
    console.log('====================================');
    console.log('📊 Workflow Test Summary:');
    console.log(`   Initial language: ${initialLang}`);
    console.log(`   After English switch: ${afterEnglishSwitch}`);
    console.log(`   Final language: ${finalLang}`);
    console.log(`   Test Result: ${finalLang === initialLang ? '✅ SUCCESS - Language restored' : '⚠️  WARNING - Language not restored'}`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testScheduledWorkflow();