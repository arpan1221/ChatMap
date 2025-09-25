ChatMap: Complete Cursor Development Guide
📋 Project Context & Architecture
What We're Building
ChatMap - A conversational isochrone mapping tool where users can type natural language queries like "coffee shops I can bike to in 15 minutes" and get instant visual results with AI explanations.
Core Innovation

Natural Language → Map Visualization: First tool to combine conversational AI with isochrone mapping
100% Free Stack: Ollama (local LLM) + OpenRouteService + Overpass API + OpenStreetMap
Mobile-First: Real-world location queries are primarily mobile

Technical Stack
Frontend: Next.js 14 + React + TypeScript + Tailwind CSS
Mapping: Leaflet + OpenStreetMap tiles
AI: Ollama (Llama 3.2 local)
APIs: OpenRouteService (isochrones) + Overpass (POIs) + Nominatim (geocoding)
Deployment: Vercel (free tier)
System Flow

User types: "Thai restaurants I can walk to in 10 minutes"
Ollama parses → {poiType: "restaurant", transport: "walking", timeMinutes: 10}
OpenRouteService generates 10-minute walking isochrone
Overpass API finds restaurants within isochrone polygon
Ollama generates natural response explaining results
Map displays isochrone + POI markers, chat shows explanation