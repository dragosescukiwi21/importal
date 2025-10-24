# Importal

**A lightweight yet powerful tool for file validations**

Importal is a comprehensive solution for handling user data imports. Built for developers who need reliable CSV and Excel processing, it provides intelligent column mapping, real-time validation, and automated conflict resolution—delivering clean, validated data to your systems.

## 🎥 See it work

https://github.com/user-attachments/assets/e832966f-82f7-4504-8217-14d2d18bba31

## What features make Importal stand out?

### 🎯 **Create Import Rules in Seconds**
Build your import schema with our visual editor:
- Drag-and-drop field creation
- Built-in validators (email, phone, URL, numbers, dates, regex)
- Required vs optional fields
- Custom validation rules
- Field descriptions and examples for your users


### 📑 **Interactive Conflict Resolution**
When validation fails, we don't just throw errors—we help fix them:
- Excel-like grid editor with cell-level validation
- Click on any red cell to see what's wrong and fix it inline
- Bulk operations for common fixes (trim whitespace, format dates, etc.)
- Export invalid rows as CSV for external cleanup
- Re-upload and merge with existing data

### ⚡ **Instant Conflict Detection**
See validation errors *as they happen*. Invalid emails? Wrong data types? Missing required fields? We catch them all and show your users exactly what needs fixing—in an interactive spreadsheet-like editor. They fix it, we revalidate in real-time.


### 🧠 **Smart Mapping**
Your users' file's columns never match your schema. Importal analyzes your field names, types and sample data to automatically map your importer rules to the file headers.


### 🤖 **AI Data Cleaning (Work In Progress)**
Experimenting with AI to fix common data issues automatically:
- "john@gmailcom" → "john@gmail.com"
- "01/02/2023" → auto-detect date format
- "Jane  Smith" → "Jane Smith" (extra spaces)
- Or suggest corrections for typos in standardized fields

### 📡 **Webhook Integration**
Clean data delivered to your API automatically:
- Configure webhook URL per importer
- Choose what data to include
- Automatic retries with exponential backoff
- Request/response logging for debugging
- Test webhooks before going live