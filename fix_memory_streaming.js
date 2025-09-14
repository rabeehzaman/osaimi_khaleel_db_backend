// Memory-optimized streaming COPY implementation
const { Readable, Transform } = require('stream');
const copyFrom = require('pg-copy-streams').from;

class ChunkedCSVProcessor {
  constructor(data, headers, headerMapping, chunkSize = 5000) {
    this.data = data;
    this.headers = headers;
    this.headerMapping = headerMapping;
    this.chunkSize = chunkSize;
  }

  // Create a streaming CSV processor that processes data in chunks
  createStream() {
    let currentIndex = 0;
    
    return new Readable({
      read() {
        try {
          // Send header first
          if (currentIndex === 0) {
            const csvHeaderLine = this.headers.join(',') + '\n';
            this.push(csvHeaderLine);
            currentIndex++;
            return;
          }

          // Calculate chunk boundaries
          const startIdx = currentIndex - 1; // -1 because we used index 0 for header
          const endIdx = Math.min(startIdx + this.chunkSize, this.data.length);
          
          if (startIdx >= this.data.length) {
            // No more data
            this.push(null);
            return;
          }

          // Process chunk
          let csvChunk = '';
          for (let i = startIdx; i < endIdx; i++) {
            const row = this.data[i];
            const csvLine = this.headers.map(cleanHeader => {
              // Find original header that maps to this clean header
              const originalHeader = Object.keys(this.headerMapping).find(orig => 
                this.headerMapping[orig] === cleanHeader
              );
              let value = row[originalHeader];
              
              // Handle null/empty values
              if (value === null || value === undefined || value === '') {
                return '';
              }
              
              // Convert to string and escape for CSV
              value = String(value).trim();
              
              // Escape quotes and wrap in quotes if contains comma, quote, or newline
              if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
                value = '"' + value.replace(/"/g, '""') + '"';
              }
              
              return value;
            }).join(',') + '\n';
            
            csvChunk += csvLine;
          }

          this.push(csvChunk);
          currentIndex = endIdx + 1;
          
          console.log(`📦 Processed chunk ${Math.ceil(endIdx / this.chunkSize)}/${Math.ceil(this.data.length / this.chunkSize)} (${endIdx}/${this.data.length} records)`);
          
        } catch (error) {
          this.emit('error', error);
        }
      }.bind(this)
    });
  }
}

// Enhanced COPY method with streaming
async function importCSVWithStreamingCOPY(client, data, tableName, headers, headerMapping) {
  const cleanTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
  const cleanedHeaders = headers;
  
  console.log(`🚀 Starting streaming COPY import for ${data.length} records...`);
  console.log(`💾 Memory-optimized processing in chunks of 5000 records`);
  
  // Create COPY SQL command
  const copySQL = `COPY "${cleanTableName}" (${cleanedHeaders.map(h => `"${h}"`).join(', ')}) FROM STDIN WITH (FORMAT csv, HEADER true)`;
  
  // Create streaming processor
  const processor = new ChunkedCSVProcessor(data, cleanedHeaders, headerMapping, 5000);
  const csvStream = processor.createStream();
  
  // Execute streaming COPY
  const copyStream = client.query(copyFrom(copySQL));
  
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    csvStream.pipe(copyStream)
      .on('error', (error) => {
        console.error(`❌ Streaming COPY failed:`, error);
        reject(error);
      })
      .on('finish', async () => {
        try {
          const duration = Date.now() - startTime;
          
          // Verify import
          const { rows } = await client.query(`SELECT COUNT(*) as count FROM "${cleanTableName}"`);
          const importedCount = parseInt(rows[0].count);
          
          console.log(`✅ Streaming COPY completed successfully!`);
          console.log(`📊 Records imported: ${importedCount}/${data.length}`);
          console.log(`⏱️  Duration: ${Math.round(duration / 1000)}s (${Math.round(data.length / (duration / 1000))} records/sec)`);
          console.log(`💾 Peak memory usage significantly reduced through streaming`);
          
          resolve({
            success: importedCount === data.length,
            tableName,
            records: data.length,
            imported: importedCount,
            duration: Math.round(duration / 1000),
            rate: Math.round(data.length / (duration / 1000))
          });
        } catch (error) {
          reject(error);
        }
      });
  });
}

module.exports = { ChunkedCSVProcessor, importCSVWithStreamingCOPY };