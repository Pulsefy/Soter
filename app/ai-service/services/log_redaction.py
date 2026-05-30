"""
Structured Logging with Guaranteed Redaction (Issue #461)

This module provides PII redaction utilities for the AI service.
It ensures sensitive data is never logged, matching the backend implementation.
"""

import re
from typing import Any, Dict, List, Union

SENSITIVE_KEYS = {
    # Authentication & Authorization
    'password', 'passwd', 'pwd',
    'token', 'apitoken', 'api_token', 'accesstoken', 'access_token', 
    'refreshtoken', 'refresh_token',
    'bearertoken', 'bearer_token',
    'secret', 'clientsecret', 'client_secret',
    'authorization',
    'apikey', 'api_key', 'app_key', 'appkey',
    
    # Private Keys & Credentials
    'privatekey', 'private_key', 'privkey', 'private_pem', 'private_rsa',
    'secret_key', 'secretkey',
    'keyid', 'key_id',
    
    # Payment & Financial
    'creditcard', 'credit_card', 'cardnumber', 'card_number',
    'cvv', 'cvc', 'pin',
    'accountnumber', 'account_number',
    'routing_number', 'routingnumber',
    'iban', 'bic',
    
    # Database & Connection Strings
    'connectionstring', 'connection_string',
    'dburl', 'db_url', 'database_url',
}

# PII Patterns for value-based detection
PII_PATTERNS = {
    'email': re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', re.IGNORECASE),
    'phone': re.compile(r'(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b'),
    'ssn': re.compile(r'\b\d{3}-\d{2}-\d{4}\b'),
    'credit_card': re.compile(r'\b(?:\d{4}[-\s]?){3}\d{4}\b'),
    'passport': re.compile(r'\b[A-Z]{1,2}\d{6,9}\b'),
    'drivers_license': re.compile(r'\b[A-Z]{1,2}\d{5,8}\b'),
}


def is_sensitive_key(key: str) -> bool:
    """Check if a key name indicates sensitive data."""
    return key.lower() in SENSITIVE_KEYS


def contains_pii(value: str) -> bool:
    """Check if a string value contains PII patterns."""
    if not isinstance(value, str):
        return False
    
    for pattern in PII_PATTERNS.values():
        if pattern.search(value):
            return True
    return False


def redact_pii_in_value(value: str) -> str:
    """Redact PII patterns in a string value."""
    result = str(value)
    
    # Replace emails
    result = PII_PATTERNS['email'].sub('[EMAIL]', result)
    
    # Replace phone numbers
    result = PII_PATTERNS['phone'].sub('[PHONE]', result)
    
    # Replace SSN
    result = PII_PATTERNS['ssn'].sub('[SSN]', result)
    
    # Replace credit cards
    result = PII_PATTERNS['credit_card'].sub('[CREDIT_CARD]', result)
    
    # Replace passport numbers
    result = PII_PATTERNS['passport'].sub('[PASSPORT]', result)
    
    # Replace driver's license
    result = PII_PATTERNS['drivers_license'].sub('[DRIVERS_LICENSE]', result)
    
    return result


def redact_log_data(
    data: Any,
    max_depth: int = 10,
    current_depth: int = 0,
) -> Any:
    """
    Recursively redact sensitive data and PII from log data.
    
    Handles:
    - Sensitive keys (password, token, etc.)
    - PII patterns in values (emails, phone numbers, etc.)
    - Nested dictionaries and lists
    - Circular references (via max_depth)
    
    Args:
        data: The data to redact
        max_depth: Maximum recursion depth to prevent stack overflow
        current_depth: Current recursion depth
        
    Returns:
        Redacted copy of the data
    """
    # Prevent stack overflow from circular references
    if current_depth >= max_depth:
        return '[MAX_DEPTH_EXCEEDED]'
    
    # Handle None
    if data is None:
        return data
    
    # Handle primitives (except dicts/lists)
    if not isinstance(data, (dict, list)):
        if isinstance(data, str) and len(data) > 0:
            # Check for PII in string values
            if contains_pii(data):
                return redact_pii_in_value(data)
        return data
    
    # Handle Lists
    if isinstance(data, list):
        return [
            redact_log_data(item, max_depth, current_depth + 1)
            for item in data
        ]
    
    # Handle Dictionaries
    result = {}
    for key, value in data.items():
        if is_sensitive_key(key):
            # Redact entire value for sensitive keys
            result[key] = '[REDACTED]'
        elif isinstance(value, str) and contains_pii(value):
            # Redact strings containing PII
            result[key] = redact_pii_in_value(value)
        elif isinstance(value, (dict, list)):
            # Recursively process nested structures
            result[key] = redact_log_data(value, max_depth, current_depth + 1)
        else:
            result[key] = value
    
    return result


def assert_no_pii_in_logs(data: Any) -> None:
    """
    Assert that no PII appears in log data.
    
    Useful for testing to ensure redaction is working correctly.
    Throws an error if sensitive data is detected.
    
    Args:
        data: The data to check
        
    Raises:
        AssertionError: If PII patterns are detected
    """
    data_str = str(data)
    
    # Check if PII patterns exist in the data
    for pattern_name, pattern in PII_PATTERNS.items():
        if pattern.search(data_str):
            raise AssertionError(
                f"PII pattern ({pattern_name}) detected in logs: {data_str[:200]}..."
            )
