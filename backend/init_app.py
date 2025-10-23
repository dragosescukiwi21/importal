import os
import asyncio
from app.db.init_db import init_db
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

async def init():
    # Initialize database and create superuser
    await init_db()
    print("Database initialization completed")

if __name__ == "__main__":
    asyncio.run(init())
