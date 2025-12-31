-- Initialize f3prod_dev database with required extensions, types, and schema
-- This script runs automatically when the PostgreSQL container initializes with an empty data volume

CREATE EXTENSION IF NOT EXISTS citext;

-- Create custom types used by the users table
CREATE TYPE public.user_status AS ENUM ('active', 'inactive');

-- Create trigger function for updated timestamps (used by triggers)
CREATE OR REPLACE FUNCTION public.set_updated_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = timezone('utc', now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create auth schema for auth-related tables
CREATE SCHEMA IF NOT EXISTS auth;
GRANT ALL ON SCHEMA auth TO f3prod;
