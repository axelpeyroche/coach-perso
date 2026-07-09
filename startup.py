"""
Script de démarrage exécuté avant uvicorn sur Render.
Se limite aux migrations DB — le programme est initialisé via l'UI.
"""
from database import creer_tables

if __name__ == "__main__":
    creer_tables()
    print("[startup] Tables et migrations OK.")
