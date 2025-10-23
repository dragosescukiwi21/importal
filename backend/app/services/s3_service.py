"""
S3 Service for handling file operations with AWS S3
"""
import os
import io
import logging
import csv
from typing import Optional, Dict, Any, BinaryIO

import boto3
from botocore.exceptions import ClientError, NoCredentialsError
import pandas as pd
import openpyxl

from app.core.config import settings

logger = logging.getLogger(__name__)

try:
    import chardet  # type: ignore
except Exception:  # pragma: no cover - optional dependency, but we vendor a fallback
    chardet = None  # type: ignore


def _detect_encoding(data: bytes) -> str:
    """Detect best-effort text encoding for a CSV byte stream."""
    # Prefer BOM-safe UTF-8 if BOM is present
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    if chardet is not None:
        try:
            result = chardet.detect(data)
            enc = (result.get("encoding") or "utf-8").lower()
            # Normalize some common labels
            if enc in {"ascii", "us-ascii"}:
                return "utf-8"
            return enc
        except Exception:
            pass
    # Fallbacks: utf-8-sig -> utf-8 -> latin-1
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            data.decode(enc)
            return enc
        except Exception:
            continue
    return "utf-8"


def _sniff_delimiter(sample_text: str) -> Optional[str]:
    """Guess a delimiter from a text sample; return None to let pandas auto-detect."""
    # Try Python's CSV sniffer first
    try:
        dialect = csv.Sniffer().sniff(sample_text, delimiters=[",", ";", "\t", "|", ":"])
        return dialect.delimiter
    except Exception:
        pass
    # Simple heuristic: pick the delimiter with the highest count on the first non-empty line
    for line in sample_text.splitlines():
        if line.strip():
            candidates = [(",", line.count(",")), (";", line.count(";")), ("\t", line.count("\t")), ("|", line.count("|"))]
            best = max(candidates, key=lambda x: x[1])
            return best[0] if best[1] > 0 else None
    return None


class S3Service:
    def __init__(self):
        """Initialize S3 service with AWS credentials"""
        try:
            self.s3_client = boto3.client(
                's3',
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                region_name=settings.AWS_REGION
            )
            self.bucket_name = settings.S3_BUCKET_NAME
            
            # Test connection
            self.s3_client.head_bucket(Bucket=self.bucket_name)
            logger.info(f"Successfully connected to S3 bucket: {self.bucket_name}")
            
        except NoCredentialsError:
            logger.error("AWS credentials not found")
            raise
        except ClientError as e:
            logger.error(f"Failed to connect to S3: {e}")
            raise
    
    def upload_file(self, file_obj: BinaryIO, key: str, content_type: str = None) -> bool:
        """
        Upload a file object to S3
        
        Args:
            file_obj: File object to upload
            key: S3 object key (file path in bucket)
            content_type: MIME type of the file
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            extra_args = {}
            if content_type:
                extra_args['ContentType'] = content_type
            
            # Reset file pointer to beginning
            file_obj.seek(0)
            
            self.s3_client.upload_fileobj(
                file_obj,
                self.bucket_name,
                key,
                ExtraArgs=extra_args
            )
            
            logger.info(f"Successfully uploaded file to S3: {key}")
            return True
            
        except ClientError as e:
            logger.error(f"Failed to upload file to S3: {e}")
            return False
    
    def download_file(self, key: str) -> Optional[bytes]:
        """
        Download a file from S3
        
        Args:
            key: S3 object key (file path in bucket)
            
        Returns:
            bytes: File content or None if failed
        """
        try:
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=key)
            return response['Body'].read()
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchKey':
                logger.warning(f"File not found in S3: {key}")
            else:
                logger.error(f"Failed to download file from S3: {e}")
            return None
    
    def download_file_as_dataframe(self, key: str) -> Optional[pd.DataFrame]:
        """
        Download a file from S3 and return as pandas DataFrame with robust parsing.
        Supports CSV, XLS, XLSX, and ODS files.
        - Detects encoding (BOM/chardet fallback) for CSV files
        - Guesses delimiter (CSV Sniffer + heuristic) for CSV files
        - Returns all values as strings with missing cells as empty strings
        """
        try:
            # Get file content
            file_content = self.download_file(key)
            if file_content is None:
                return None
            
            # Determine file type from key extension
            file_ext = key.lower().split('.')[-1] if '.' in key else 'csv'
            
            if file_ext in ['xlsx', 'xls', 'ods']:
                return self._parse_excel_file(file_content, file_ext)
            else:
                return self._parse_csv_file(file_content)
            
        except Exception as e:
            logger.error(f"Failed to read file from S3: {e}")
            return None
    
    def _parse_excel_file(self, file_content: bytes, file_ext: str) -> pd.DataFrame:
        """Parse Excel files (XLS, XLSX, ODS) using openpyxl/pandas."""
        try:
            # Create a BytesIO object for pandas to read
            file_obj = io.BytesIO(file_content)
            
            # Use pandas to read Excel files
            if file_ext == 'xlsx':
                df = pd.read_excel(file_obj, engine='openpyxl', dtype=str, keep_default_na=False, na_filter=False)
            elif file_ext == 'xls':
                df = pd.read_excel(file_obj, engine='xlrd', dtype=str, keep_default_na=False, na_filter=False)
            elif file_ext == 'ods':
                df = pd.read_excel(file_obj, engine='odf', dtype=str, keep_default_na=False, na_filter=False)
            else:
                raise ValueError(f"Unsupported Excel format: {file_ext}")
            
            # Ensure no NaN remain from ragged rows or parser quirks
            df = df.fillna("")
            return df
            
        except Exception as e:
            logger.error(f"Failed to parse Excel file: {e}")
            raise
    
    def _parse_csv_file(self, file_content: bytes) -> pd.DataFrame:
        """Parse CSV files with robust encoding and delimiter detection."""
        try:
            # Detect encoding and decode to text
            encoding = _detect_encoding(file_content)
            text = file_content.decode(encoding, errors="replace")
            
            # Guess delimiter from a sample
            sample = text[:65536]
            delimiter = _sniff_delimiter(sample)
            
            # Parse with pandas using robust string/NA handling
            # For single column CSVs, delimiter will be None, so default to comma
            df = pd.read_csv(
                io.StringIO(text),
                sep=delimiter if delimiter else ",",
                dtype=str,
                keep_default_na=False,
                na_filter=False,
            )
            
            # Ensure no NaN remain from ragged rows or parser quirks
            df = df.fillna("")
            return df
            
        except Exception as e:
            logger.error(f"Failed to parse CSV file: {e}")
            raise
    
    def save_dataframe_to_s3(self, df: pd.DataFrame, key: str, **kwargs) -> bool:
        """
        Save a pandas DataFrame to S3 as CSV
        
        Args:
            df: DataFrame to save
            key: S3 object key (file path in bucket)
            **kwargs: Additional arguments to pass to df.to_csv
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            # Convert DataFrame to CSV string
            csv_buffer = io.StringIO()
            # Make sure we don't write NaN
            df = df.fillna("")
            df.to_csv(csv_buffer, index=False, **kwargs)
            
            # Convert to bytes
            csv_bytes = csv_buffer.getvalue().encode('utf-8')
            
            # Upload to S3
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=key,
                Body=csv_bytes,
                ContentType='text/csv'
            )
            
            logger.info(f"Successfully saved DataFrame to S3: {key}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to save DataFrame to S3: {e}")
            return False
    
    def file_exists(self, key: str) -> bool:
        """
        Check if a file exists in S3
        
        Args:
            key: S3 object key (file path in bucket)
            
        Returns:
            bool: True if file exists, False otherwise
        """
        try:
            self.s3_client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                return False
            else:
                logger.error(f"Error checking file existence in S3: {e}")
                return False
    
    def delete_file(self, key: str) -> bool:
        """
        Delete a file from S3
        
        Args:
            key: S3 object key (file path in bucket)
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=key)
            logger.info(f"Successfully deleted file from S3: {key}")
            return True
            
        except ClientError as e:
            logger.error(f"Failed to delete file from S3: {e}")
            return False
    
    def copy_file(self, source_key: str, destination_key: str) -> bool:
        """
        Copy a file within the same S3 bucket
        
        Args:
            source_key: Source S3 object key
            destination_key: Destination S3 object key
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            copy_source = {
                'Bucket': self.bucket_name,
                'Key': source_key
            }
            self.s3_client.copy_object(
                CopySource=copy_source,
                Bucket=self.bucket_name,
                Key=destination_key
            )
            logger.info(f"Successfully copied file in S3: {source_key} -> {destination_key}")
            return True
            
        except ClientError as e:
            logger.error(f"Failed to copy file in S3: {e}")
            return False
    
    def list_files(self, prefix: str = "") -> list:
        """
        List files in S3 bucket with optional prefix
        
        Args:
            prefix: Prefix to filter files
            
        Returns:
            list: List of file keys
        """
        try:
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=prefix
            )
            
            if 'Contents' in response:
                return [obj['Key'] for obj in response['Contents']]
            else:
                return []
                
        except ClientError as e:
            logger.error(f"Failed to list files in S3: {e}")
            return []
    
    def get_file_url(self, key: str, expiration: int = 3600) -> Optional[str]:
        """
        Generate a presigned URL for downloading a file
        
        Args:
            key: S3 object key (file path in bucket)
            expiration: URL expiration time in seconds
            
        Returns:
            str: Presigned URL or None if failed
        """
        try:
            url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket_name, 'Key': key},
                ExpiresIn=expiration
            )
            return url
            
        except ClientError as e:
            logger.error(f"Failed to generate presigned URL: {e}")
            return None
    
    def get_upload_url(self, key: str, expiration: int = 3600, content_type: str = None) -> Optional[Dict[str, Any]]:
        """
        Generate a presigned URL for uploading a file
        
        Args:
            key: S3 object key (file path in bucket)
            expiration: URL expiration time in seconds
            content_type: MIME type of the file
            
        Returns:
            dict: Presigned URL data or None if failed
        """
        try:
            fields = {}
            conditions = []
            
            if content_type:
                fields['Content-Type'] = content_type
                conditions.append({'Content-Type': content_type})
            
            response = self.s3_client.generate_presigned_post(
                Bucket=self.bucket_name,
                Key=key,
                Fields=fields,
                Conditions=conditions,
                ExpiresIn=expiration
            )
            
            return response
            
        except ClientError as e:
            logger.error(f"Failed to generate presigned upload URL: {e}")
            return None
    

# Global S3 service instance
s3_service = None

def get_s3_service() -> S3Service:
    """Get S3 service instance (singleton pattern)"""
    global s3_service
    if s3_service is None:
        s3_service = S3Service()
    return s3_service
