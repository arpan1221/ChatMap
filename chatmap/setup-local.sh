#!/bin/bash

echo "🚀 Setting up ChatMap with local mem0ai, Qdrant, and Ollama..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    print_error "Docker Compose is not available. Please install Docker Compose first."
    exit 1
fi

# Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
    print_warning "Ollama is not installed. Please install Ollama first:"
    echo "  macOS: brew install ollama"
    echo "  Linux: curl -fsSL https://ollama.ai/install.sh | sh"
    echo "  Windows: Download from https://ollama.ai/download"
    exit 1
fi

print_status "All prerequisites are installed"

# Start Qdrant with Docker Compose
echo "🐳 Starting Qdrant..."
if command -v docker-compose &> /dev/null; then
    docker-compose up -d
else
    docker compose up -d
fi

# Wait for Qdrant to be ready
echo "⏳ Waiting for Qdrant to be ready..."
sleep 10

# Check if Qdrant is running
if curl -s http://localhost:6333/health > /dev/null; then
    print_status "Qdrant is running on http://localhost:6333"
else
    print_error "Failed to start Qdrant. Please check Docker logs."
    exit 1
fi

# Start Ollama service
echo "🦙 Starting Ollama service..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
echo "⏳ Waiting for Ollama to be ready..."
sleep 5

# Check if Ollama is running
if curl -s http://localhost:11434/api/tags > /dev/null; then
    print_status "Ollama is running on http://localhost:11434"
else
    print_error "Failed to start Ollama. Please check Ollama installation."
    exit 1
fi

# Pull required models
echo "📥 Pulling required Ollama models..."

echo "  - Pulling nomic-text:latest (for embeddings)..."
ollama pull nomic-text:latest

echo "  - Pulling llama3.2:3b (for LLM)..."
ollama pull llama3.2:3b

print_status "All models downloaded"

# Create .env.local if it doesn't exist
if [ ! -f .env.local ]; then
    echo "📝 Creating .env.local file..."
    cat > .env.local << EOF
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
# ORS_API_KEY=your_ors_api_key_here
EOF
    print_status ".env.local file created"
else
    print_warning ".env.local already exists, skipping creation"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

print_status "Setup complete! 🎉"

echo ""
echo "Next steps:"
echo "1. Add your OpenRouteService API key to .env.local (optional, for mapping features)"
echo "2. Start the development server: npm run dev"
echo "3. Visit http://localhost:3000 to test the application"
echo ""
echo "Services running:"
echo "  - Qdrant: http://localhost:6333"
echo "  - Ollama: http://localhost:11434"
echo "  - Next.js: http://localhost:3000 (after running npm run dev)"
echo ""
echo "To stop services:"
echo "  - Stop Qdrant: docker-compose down"
echo "  - Stop Ollama: kill $OLLAMA_PID"
