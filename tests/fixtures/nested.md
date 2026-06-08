# Project Overview

This project is a documentation tool.

## Architecture

The system has multiple layers.

### Frontend

The frontend is built with React.

#### Components

We use atomic design patterns.

#### Routing

Client-side routing via React Router.

### Backend

The backend is a Node.js API.

#### Database

PostgreSQL with Prisma ORM.

#### Authentication

JWT-based auth with refresh tokens.

## Deployment

We deploy to AWS using Terraform.

### Staging

Staging auto-deploys from `develop` branch.

### Production

Production requires manual approval.

#### Rollback

Use the rollback script in `/scripts/rollback.sh`.
