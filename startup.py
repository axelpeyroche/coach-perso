"""
Script de démarrage exécuté avant uvicorn sur Render.
Crée les tables manquantes et applique les migrations de colonnes.
"""
from database import creer_tables

if __name__ == "__main__":
    creer_tables()
    print("[startup] Tables et migrations OK.")
