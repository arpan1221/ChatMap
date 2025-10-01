#!/bin/bash

echo "🚀 Setting up ChatMap with Memory & AI..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18+ first."
    echo "  Visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version must be 18 or higher. Current: $(node -v)"
    exit 1
fi

print_status "Node.js $(node -v) detected"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    echo ""
    echo "  macOS:   Download from https://www.docker.com/products/docker-desktop"
    echo "  Linux:   curl -fsSL https://get.docker.com | sh"
    echo "  Windows: Download from https://www.docker.com/products/docker-desktop"
    echo ""
    exit 1
fi

print_status "Docker is installed"

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    print_error "Docker Compose is not available. Please install Docker Compose first."
    exit 1
fi

print_status "Docker Compose is available"

# Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
    print_error "Ollama is not installed. Please install Ollama first:"
    echo ""
    echo "  macOS:   curl -fsSL https://ollama.ai/install.sh | sh"
    echo "  Linux:   curl -fsSL https://ollama.ai/install.sh | sh"
    echo "  Windows: Download from https://ollama.ai/download"
    echo ""
    exit 1
fi

print_status "Ollama is installed"

# Start Qdrant with Docker Compose
echo ""
echo "🐳 Starting Qdrant vector database..."
if command -v docker-compose &> /dev/null; then
    docker-compose up -d
else
    docker compose up -d
fi

# Wait for Qdrant to be ready
echo "⏳ Waiting for Qdrant to be ready..."
sleep 10

# Check if Qdrant is running
if curl -s http://localhost:6333/health > /dev/null 2>&1; then
    print_status "Qdrant is running on http://localhost:6333"
else
    print_error "Failed to start Qdrant. Please check Docker logs:"
    echo "  docker-compose logs qdrant"
    exit 1
fi

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    print_warning "Ollama is not running. Starting Ollama..."
    ollama serve > /dev/null 2>&1 &
    sleep 3
    
    if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        print_error "Failed to start Ollama. Please start it manually:"
        echo "  Run: ollama serve"
        exit 1
    fi
fi

print_status "Ollama is running on http://localhost:11434"

# Pull required Ollama models
echo ""
echo "📥 Downloading required AI models (this may take a few minutes)..."
echo ""

# Check if llama3.2:3b is already installed
if ollama list | grep -q "llama3.2:3b"; then
    print_status "llama3.2:3b already installed"
else
    print_info "Downloading llama3.2:3b (~2GB)..."
    ollama pull llama3.2:3b
    print_status "llama3.2:3b downloaded"
fi

# Check if nomic-embed-text is already installed
if ollama list | grep -q "nomic-embed-text"; then
    print_status "nomic-embed-text already installed"
else
    print_info "Downloading nomic-embed-text (~274MB)..."
    ollama pull nomic-embed-text
    print_status "nomic-embed-text downloaded"
fi

# Install npm dependencies
echo ""
print_info "Installing npm dependencies..."
npm install

if [ $? -ne 0 ]; then
    print_error "Failed to install dependencies"
    exit 1
fi

print_status "Dependencies installed"

# Create .env.local if it doesn't exist
echo ""
if [ ! -f .env.local ]; then
    print_info "Creating .env.local file..."
    
    # Prompt for OpenRouteService API key
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  OpenRouteService API Key Required"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "ChatMap needs an OpenRouteService API key for:"
    echo "  • Route calculations"
    echo "  • Isochrone generation"
    echo "  • Travel time matrices"
    echo ""
    echo "Get your FREE API key at:"
    echo "  🔗 https://openrouteservice.org/dev/#/signup"
    echo ""
    read -p "Enter your OpenRouteService API key: " ORS_KEY
    
    if [ -z "$ORS_KEY" ]; then
        print_warning "No API key entered. You can add it later to .env.local"
        ORS_KEY="your_api_key_here"
    fi
    
    cat > .env.local << EOF
# ============================================================================
# OpenRouteService API (Required)
# ============================================================================
# Get your free API key at: https://openrouteservice.org/dev/#/signup
OPENROUTESERVICE_API_KEY=$ORS_KEY

# ============================================================================
# Ollama Configuration (Local LLM)
# ============================================================================
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_TIMEOUT=30000

# ============================================================================
# Nominatim Configuration (Geocoding)
# ============================================================================
NOMINATIM_ENDPOINT=https://nominatim.openstreetmap.org
NOMINATIM_USER_AGENT=ChatMap/1.0
NOMINATIM_RATE_LIMIT_MS=1000

# ============================================================================
# Overpass API Configuration (POI Search)
# ============================================================================
OVERPASS_ENDPOINT=https://overpass-api.de/api/interpreter
OVERPASS_TIMEOUT=25000

# ============================================================================
# Memory Configuration (Qdrant + Embeddings)
# ============================================================================
MEMORY_ENABLED=true
QDRANT_URL=http://localhost:6333
# QDRANT_API_KEY=  # Optional for local Qdrant
MEMORY_EMBEDDING_MODEL=nomic-embed-text
MEMORY_COLLECTION_NAME=chatmap_memories

# ============================================================================
# Application Configuration
# ============================================================================
NODE_ENV=development
EOF
    
    print_status ".env.local created"
else
    print_warning ".env.local already exists, skipping creation"
fi

# Success message
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
print_status "Setup complete! 🎉"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Next Steps:"
echo ""
echo "  1. Review your .env.local configuration"
if [ "$ORS_KEY" = "your_api_key_here" ]; then
    echo "  2. Add your OpenRouteService API key to .env.local"
    echo "  3. Start the development server:"
else
    echo "  2. Start the development server:"
fi
echo ""
echo "     ${GREEN}npm run dev${NC}"
echo ""
echo "  Then open: ${BLUE}http://localhost:3000${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🤖 Services Running:"
echo "  • Qdrant:   http://localhost:6333 (vector database)"
echo "  • Ollama:   http://localhost:11434 (AI models)"
echo "  • Next.js:  http://localhost:3000 (after npm run dev)"
echo ""
echo "🧠 Memory Features:"
echo "  • Semantic search with 768-dim embeddings"
echo "  • User preference learning"
echo "  • Conversation history tracking"
echo "  • Location pattern recognition"
echo ""
echo "🧪 Test Queries to Try:"
echo '  • "Find restaurants within 15 minutes walk"'
echo '  • "Find the nearest coffee shop"'
echo '  • "Show me parks I can reach in 20 minutes by bike"'
echo '  • "Find gas station before going to the airport"'
echo ""
echo "🛠️  Manage Services:"
echo "  • Stop Qdrant:  docker-compose down"
echo "  • View logs:    docker-compose logs -f qdrant"
echo "  • Restart all:  docker-compose restart"
echo ""
echo "📖 For more info, see README.md"
echo ""