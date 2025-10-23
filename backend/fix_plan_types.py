#!/usr/bin/env python3
"""
Script to update plan_type values from title case to uppercase.
Run this script once to fix any existing data.
"""

import os
import sys

# Add the app directory to the path
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import create_engine, text
from app.core.config import settings

def main():
    """Update plan_type values to uppercase."""
    print("Connecting to database...")
    
    # Create database engine
    engine = create_engine(str(settings.DATABASE_URL))
    
    try:
        with engine.connect() as connection:
            print("Updating plan_type values to uppercase...")
            
            # Update each plan type
            updates = [
                ("Free", "FREE"),
                ("Starter", "STARTER"), 
                ("Pro", "PRO"),
                ("Scale", "SCALE")
            ]
            
            total_updated = 0
            for old_value, new_value in updates:
                result = connection.execute(
                    text("UPDATE users SET plan_type = :new_val WHERE plan_type = :old_val"),
                    {"new_val": new_value, "old_val": old_value}
                )
                updated_count = result.rowcount
                if updated_count > 0:
                    print(f"Updated {updated_count} users from '{old_value}' to '{new_value}'")
                    total_updated += updated_count
            
            # Commit the transaction
            connection.commit()
            
            if total_updated == 0:
                print("No users needed updating. All plan_type values are already correct.")
            else:
                print(f"Successfully updated {total_updated} users total.")
            
            # Show current plan type distribution
            print("\nCurrent plan type distribution:")
            result = connection.execute(
                text("SELECT plan_type, COUNT(*) as count FROM users GROUP BY plan_type ORDER BY plan_type")
            )
            for row in result:
                print(f"  {row.plan_type}: {row.count} users")
                
    except Exception as e:
        print(f"Error updating plan types: {e}")
        return 1
    
    print("Done!")
    return 0

if __name__ == "__main__":
    sys.exit(main())