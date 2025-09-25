# Mem0ai Local Setup with Qdrant and Ollama

This guide will help you set up mem0ai to work locally with Qdrant as the vector database and Ollama for embeddings and LLM.

## Prerequisites

1. **Docker** (for Qdrant)
2. **Ollama** (for embeddings and LLM)
3. **Node.js** and **npm**

## Step 1: Install Ollama

### macOS
```bash
brew install ollama
```

### Linux
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

### Windows
Download from: https://ollama.ai/download

## Step 2: Pull Required Ollama Models

```bash
# Pull the embedding model
ollama pull nomic-text:latest

# Pull the LLM model
ollama pull llama3.2:3b
```

## Step 3: Start Ollama Service

```bash
ollama serve
```

This will start Ollama on `http://localhost:11434`

## Step 4: Set up Qdrant with Docker

### Option A: Using Docker Compose (Recommended)

Create `docker-compose.yml` in your project root:

```yaml
version: '3.8'
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_storage:/qdrant/storage
    environment:
      - QDRANT__SERVICE__HTTP_PORT=6333
      - QDRANT__SERVICE__GRPC_PORT=6334
    restart: unless-stopped

volumes:
  qdrant_storage:
```

Then run:
```bash
docker-compose up -d
```

### Option B: Using Docker directly

```bash
docker run -p 6333:6333 -p 6334:6334 -v $(pwd)/qdrant_storage:/qdrant/storage qdrant/qdrant:latest
```

## Step 5: Environment Configuration

Create `.env.local` in your project root:

```bash
# Mem0ai Configuration
MEM0_LOCAL=true

# Ollama Configuration
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=nomic-text:latest
OLLAMA_LLM_MODEL=llama3.2:3b

# Qdrant Configuration
QDRANT_URL=http://localhost:6333
# QDRANT_API_KEY=your_api_key_here  # Optional for local Qdrant

# OpenRouteService API Key (for mapping functionality)
ORS_API_KEY=your_ors_api_key_here
```

## Step 6: Install Required Dependencies

```bash
npm install qdrant-client
```

## Step 7: Test the Setup

1. Start your Next.js development server:
   ```bash
   npm run dev
   ```

2. Test the memory service by visiting:
   ```
   http://localhost:3000/api/memory?resource=insights
   ```

## Step 8: Verify Services

### Check Ollama
```bash
curl http://localhost:11434/api/tags
```

### Check Qdrant
```bash
curl http://localhost:6333/collections
```

## Troubleshooting

### Ollama Issues
- Make sure Ollama is running: `ollama serve`
- Check if models are installed: `ollama list`
- Pull missing models: `ollama pull nomic-text:latest`

### Qdrant Issues
- Check if Qdrant is running: `docker ps | grep qdrant`
- Check Qdrant logs: `docker logs <container_id>`
- Verify Qdrant is accessible: `curl http://localhost:6333/health`

### Memory Service Issues
- Check the browser console for error messages
- Check the Next.js server logs
- Verify all environment variables are set correctly

## Configuration Details

### Mem0ai Configuration
- **Vector DB**: Qdrant running on localhost:6333
- **Embeddings**: nomic-text model via Ollama
- **LLM**: llama3.2:3b model via Ollama
- **Collection**: chatmap_memories

### Performance Notes
- First requests may be slower as models are loaded
- Qdrant will create the collection automatically
- Models are cached by Ollama after first use

## Production Considerations

For production deployment:
1. Use a managed Qdrant instance or self-hosted with proper security
2. Consider using more powerful models for better performance
3. Set up proper monitoring and logging
4. Configure proper backup strategies for Qdrant data
