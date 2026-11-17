# Mon Carnet en un seul service (Koyeb) : l'API FastAPI sert aussi l'interface React construite.
# La base de données reste à l'extérieur (Neon, DATABASE_URL) : rien n'est stocké dans le conteneur.

# 1. Construction de l'interface (VITE_API_URL vide : l'API est à la même adresse, sous /api)
FROM node:20-alpine AS interface
WORKDIR /src/frontend
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npx vite build

# 2. API Python + interface construite
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DOSSIER_INTERFACE=/app/interface
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . ./
COPY --from=interface /src/frontend/dist ./interface
EXPOSE 8000
# startup.py ajoute les tables/colonnes manquantes (jamais de suppression), puis lancement de l'API
CMD ["sh", "-c", "python startup.py && exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
