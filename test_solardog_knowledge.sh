#!/bin/bash

echo "Testing SolarDog Knowledge Base Access..."
echo "=========================================="
echo ""

# Set DATABASE_URL explicitly
export DATABASE_URL='postgresql://neondb_owner:npg_G7oxIEtTrql3@ep-jolly-shadow-a8j1n17p-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require'

# Call the assistant endpoint with a question about SolarPro buttons
echo "Sending test question to SolarDog..."
curl -s -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What does the Apply Recommended Configuration button do?",
    "conversationHistory": []
  }' | python3 -m json.tool | head -50

echo ""
echo "=========================================="
echo "Test complete!"