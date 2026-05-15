#!/bin/bash
set -e
git pull origin main
npm install --production
pm2 restart glyffi-bot
echo "Deployed v$(node -p "require('./package.json').version")"
