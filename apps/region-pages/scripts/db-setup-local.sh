#!/usr/bin/env bash

npm run supabase:start
cp .env.local.sample .env.local
npm run db:reset
npm run db:migrate
npm run db:seed