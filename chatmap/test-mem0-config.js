/**
 * Test script to verify mem0ai configuration with Qdrant and Ollama
 * Run with: node test-mem0-config.js
 */

const { MemoryClient } = require('mem0ai');

async function testMem0Config() {
  console.log('🧪 Testing mem0ai configuration...\n');

  try {
    // Test configuration
    const config = {
      // Vector database configuration
      vectorDB: {
        provider: 'qdrant',
        config: {
          url: 'http://localhost:6333',
          collectionName: 'chatmap_memories_test',
        },
      },
      // Embedding configuration
      embedding: {
        provider: 'ollama',
        config: {
          model: 'nomic-text:latest',
          baseUrl: 'http://localhost:11434',
        },
      },
      // LLM configuration
      llm: {
        provider: 'ollama',
        config: {
          model: 'llama3.2:3b',
          baseUrl: 'http://localhost:11434',
        },
      },
    };

    console.log('📋 Configuration:');
    console.log(JSON.stringify(config, null, 2));
    console.log('');

    // Initialize MemoryClient
    console.log('🔧 Initializing MemoryClient...');
    const client = new MemoryClient({ config });
    console.log('✅ MemoryClient initialized successfully\n');

    // Test adding a memory
    console.log('💾 Testing memory operations...');
    const memoryId = await client.addMemory({
      messages: [
        {
          role: 'user',
          content: 'I love Italian food and prefer restaurants near downtown'
        }
      ],
      metadata: {
        userId: 'test-user',
        type: 'preference',
        location: 'downtown'
      }
    });
    console.log(`✅ Memory added with ID: ${memoryId}\n`);

    // Test searching memories
    console.log('🔍 Testing memory search...');
    const searchResults = await client.searchMemories({
      query: 'Italian food preferences',
      limit: 5
    });
    console.log(`✅ Found ${searchResults.length} memories`);
    console.log('Search results:', JSON.stringify(searchResults, null, 2));
    console.log('');

    // Test getting memories
    console.log('📖 Testing get memories...');
    const memories = await client.getMemories({
      limit: 10
    });
    console.log(`✅ Retrieved ${memories.length} memories`);
    console.log('');

    console.log('🎉 All tests passed! mem0ai is configured correctly.');
    console.log('\nYour setup:');
    console.log('  - Vector DB: Qdrant ✅');
    console.log('  - Embeddings: Ollama nomic-text ✅');
    console.log('  - LLM: Ollama llama3.2:3b ✅');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Make sure Qdrant is running: docker-compose up -d');
    console.error('2. Make sure Ollama is running: ollama serve');
    console.error('3. Make sure models are installed:');
    console.error('   - ollama pull nomic-text:latest');
    console.error('   - ollama pull llama3.2:3b');
    console.error('4. Check if ports are available:');
    console.error('   - Qdrant: http://localhost:6333');
    console.error('   - Ollama: http://localhost:11434');
  }
}

// Run the test
testMem0Config();
