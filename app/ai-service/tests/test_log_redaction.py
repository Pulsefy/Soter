"""
Tests for Structured Logging with Guaranteed Redaction (Issue #461)

Tests cover:
- Redaction of sensitive keys
- PII pattern detection and redaction
- Nested structure handling
- Integration with structured logging
"""

import pytest
from services.log_redaction import (
    redact_log_data,
    assert_no_pii_in_logs,
    is_sensitive_key,
    contains_pii,
    redact_pii_in_value,
)


class TestSensitiveKeyDetection:
    """Test detection of sensitive keys."""
    
    def test_detects_password_fields(self):
        """Should detect password field names."""
        assert is_sensitive_key('password') is True
        assert is_sensitive_key('PASSWORD') is True
        assert is_sensitive_key('PaSsWoRd') is True
        assert is_sensitive_key('passwd') is True
    
    def test_detects_token_fields(self):
        """Should detect token field names."""
        assert is_sensitive_key('token') is True
        assert is_sensitive_key('access_token') is True
        assert is_sensitive_key('bearer_token') is True
        assert is_sensitive_key('TOKEN') is True
    
    def test_detects_api_key_fields(self):
        """Should detect API key field names."""
        assert is_sensitive_key('apikey') is True
        assert is_sensitive_key('api_key') is True
        assert is_sensitive_key('API_KEY') is True
    
    def test_detects_secret_fields(self):
        """Should detect secret field names."""
        assert is_sensitive_key('secret') is True
        assert is_sensitive_key('client_secret') is True
        assert is_sensitive_key('private_key') is True
    
    def test_detects_financial_fields(self):
        """Should detect financial field names."""
        assert is_sensitive_key('creditcard') is True
        assert is_sensitive_key('accountnumber') is True
    
    def test_ignores_normal_fields(self):
        """Should not flag normal field names as sensitive."""
        assert is_sensitive_key('username') is False
        assert is_sensitive_key('user_id') is False
        assert is_sensitive_key('email_address') is False
        assert is_sensitive_key('created_at') is False


class TestPIIPatternDetection:
    """Test detection of PII patterns in values."""
    
    def test_detects_emails(self):
        """Should detect email addresses."""
        assert contains_pii('user@example.com') is True
        assert contains_pii('john.doe+tag@company.co.uk') is True
        assert contains_pii('Contact: test@test.org here') is True
    
    def test_detects_phone_numbers(self):
        """Should detect phone numbers."""
        assert contains_pii('555-123-4567') is True
        assert contains_pii('(555) 123-4567') is True
        assert contains_pii('+1-555-123-4567') is True
        assert contains_pii('555.123.4567') is True
    
    def test_detects_ssn(self):
        """Should detect SSN patterns."""
        assert contains_pii('123-45-6789') is True
        assert contains_pii('SSN: 111-22-3333') is True
    
    def test_detects_credit_cards(self):
        """Should detect credit card patterns."""
        assert contains_pii('4532-1234-5678-9010') is True
        assert contains_pii('4532 1234 5678 9010') is True
    
    def test_ignores_normal_strings(self):
        """Should not flag normal strings as PII."""
        assert contains_pii('username123') is False
        assert contains_pii('user_id_456') is False
        assert contains_pii('2024-01-01') is False
        assert contains_pii('') is False
    
    def test_handles_non_string_values(self):
        """Should handle non-string values safely."""
        assert contains_pii(123) is False
        assert contains_pii(None) is False
        assert contains_pii([]) is False


class TestPIIRedaction:
    """Test PII redaction in values."""
    
    def test_redacts_emails(self):
        """Should redact email addresses."""
        result = redact_pii_in_value('Contact: user@example.com please')
        assert '[EMAIL]' in result
        assert '@' not in result
    
    def test_redacts_phone_numbers(self):
        """Should redact phone numbers."""
        result = redact_pii_in_value('Call (555) 123-4567 anytime')
        assert '[PHONE]' in result
        assert '555' not in result
    
    def test_redacts_ssn(self):
        """Should redact SSN."""
        result = redact_pii_in_value('My SSN is 123-45-6789')
        assert '[SSN]' in result
        assert '123-45-6789' not in result
    
    def test_redacts_multiple_patterns(self):
        """Should redact multiple PII patterns in one value."""
        text = 'Email: test@example.com, Phone: 555-123-4567'
        result = redact_pii_in_value(text)
        assert '[EMAIL]' in result
        assert '[PHONE]' in result
        assert '@' not in result


class TestRedactLogData:
    """Test complete log data redaction."""
    
    def test_redacts_sensitive_keys(self):
        """Should redact values for sensitive keys."""
        data = {
            'username': 'john',
            'password': 'secret123',
            'apikey': 'sk_live_1234567890',
        }
        result = redact_log_data(data)
        assert result['username'] == 'john'
        assert result['password'] == '[REDACTED]'
        assert result['apikey'] == '[REDACTED]'
    
    def test_redacts_pii_in_values(self):
        """Should redact PII patterns in values."""
        data = {
            'user_message': 'Contact me at test@example.com',
            'contact_phone': '555-123-4567',
        }
        result = redact_log_data(data)
        assert '[EMAIL]' in result['user_message']
        assert '@' not in result['user_message']
        assert '[PHONE]' in result['contact_phone']
    
    def test_handles_nested_objects(self):
        """Should redact nested objects."""
        data = {
            'level1': {
                'level2': {
                    'password': 'secret',
                    'name': 'John Doe',
                },
            },
        }
        result = redact_log_data(data)
        assert result['level1']['level2']['password'] == '[REDACTED]'
        assert result['level1']['level2']['name'] == 'John Doe'
    
    def test_handles_lists(self):
        """Should redact items in lists."""
        data = {
            'users': [
                {'name': 'John', 'password': 'pwd1'},
                {'name': 'Jane', 'password': 'pwd2'},
            ],
        }
        result = redact_log_data(data)
        assert result['users'][0]['password'] == '[REDACTED]'
        assert result['users'][1]['password'] == '[REDACTED]'
        assert result['users'][0]['name'] == 'John'
    
    def test_handles_null_and_none(self):
        """Should handle None values."""
        data = {
            'a': None,
            'b': 'value',
        }
        result = redact_log_data(data)
        assert result['a'] is None
        assert result['b'] == 'value'
    
    def test_preserves_numeric_values(self):
        """Should preserve numeric values."""
        data = {
            'count': 42,
            'ratio': 3.14,
            'active': True,
        }
        result = redact_log_data(data)
        assert result['count'] == 42
        assert result['ratio'] == 3.14
        assert result['active'] is True
    
    def test_prevents_circular_references(self):
        """Should handle circular references via max_depth."""
        data: dict = {'name': 'test'}
        data['self'] = data  # Create circular reference
        
        # Should not raise an exception
        result = redact_log_data(data, max_depth=5)
        assert result is not None


class TestRealWorldScenarios:
    """Test real-world logging scenarios."""
    
    def test_request_payload_with_credentials(self):
        """Should redact request payload with sensitive data."""
        request = {
            'method': 'POST',
            'path': '/api/verify',
            'body': {
                'email': 'user@example.com',
                'password': 'password123',
                'phone': '555-123-4567',
            },
            'headers': {
                'authorization': 'Bearer token123',
                'content_type': 'application/json',
            },
        }
        result = redact_log_data(request)
        assert result['body']['password'] == '[REDACTED]'
        assert result['headers']['authorization'] == '[REDACTED]'
        assert '[EMAIL]' in result['body']['email']
        assert '[PHONE]' in result['body']['phone']
    
    def test_response_with_sensitive_data(self):
        """Should redact response payload with sensitive data."""
        response = {
            'status_code': 200,
            'data': {
                'id': 'user-123',
                'email': 'user@example.com',
                'api_token': 'secret-token-xyz',
            },
        }
        result = redact_log_data(response)
        assert result['status_code'] == 200
        assert result['data']['id'] == 'user-123'
        assert '[EMAIL]' in result['data']['email']
        assert result['data']['api_token'] == '[REDACTED]'
    
    def test_error_log_with_connection_string(self):
        """Should redact database connection strings."""
        error_log = {
            'error_type': 'DatabaseError',
            'connection_string': 'postgres://user:password123@db.example.com/soter',
            'query': 'SELECT * FROM users',
        }
        result = redact_log_data(error_log)
        assert result['error_type'] == 'DatabaseError'
        assert '[REDACTED]' in result['connection_string']
        assert result['query'] == 'SELECT * FROM users'
    
    def test_oauth_callback_payload(self):
        """Should redact OAuth callback with credentials."""
        payload = {
            'code': 'auth-code-123',
            'state': 'state-456',
            'client_secret': 'secret-key-xyz',
            'access_token': 'token-789',
            'redirect_uri': 'https://app.example.com/callback',
        }
        result = redact_log_data(payload)
        assert result['code'] == 'auth-code-123'
        assert result['client_secret'] == '[REDACTED]'
        assert result['access_token'] == '[REDACTED]'
        assert result['redirect_uri'] == 'https://app.example.com/callback'


class TestAssertNoPII:
    """Test PII assertion function."""
    
    def test_passes_for_clean_data(self):
        """Should not raise for data without PII."""
        data = {
            'request_id': 'req-123',
            'status_code': 200,
        }
        # Should not raise
        assert_no_pii_in_logs(data)
    
    def test_fails_for_unredacted_email(self):
        """Should raise if email is not redacted."""
        data = {'message': 'Contact: test@example.com'}
        with pytest.raises(AssertionError):
            assert_no_pii_in_logs(data)
    
    def test_fails_for_unredacted_phone(self):
        """Should raise if phone number is not redacted."""
        data = {'message': 'Call (555) 123-4567'}
        with pytest.raises(AssertionError):
            assert_no_pii_in_logs(data)
    
    def test_passes_for_redacted_data(self):
        """Should pass for properly redacted data."""
        data = {'message': 'Email: test@example.com'}
        redacted = redact_log_data(data)
        # Should not raise
        assert_no_pii_in_logs(redacted)


class TestEdgeCases:
    """Test edge cases and special scenarios."""
    
    def test_empty_structures(self):
        """Should handle empty dictionaries and lists."""
        assert redact_log_data({}) == {}
        assert redact_log_data([]) == []
        assert redact_log_data({'items': []}) == {'items': []}
    
    def test_mixed_nested_structures(self):
        """Should handle mixed nesting of dicts and lists."""
        data = {
            'items': [
                {'id': 1, 'password': 'pwd1'},
                {'id': 2, 'nested': {'secret': 'secret-value'}},
            ],
        }
        result = redact_log_data(data)
        assert result['items'][0]['password'] == '[REDACTED]'
        assert result['items'][1]['nested']['secret'] == '[REDACTED]'
    
    def test_unicode_characters(self):
        """Should handle unicode characters in values."""
        data = {
            'message': 'Привет user@example.com',
            'name': '中文名 test@example.com',
        }
        result = redact_log_data(data)
        assert '[EMAIL]' in result['message']
        assert '[EMAIL]' in result['name']
    
    def test_special_characters_in_sensitive_keys(self):
        """Should handle keys with special characters."""
        data = {
            'api_key-prod': 'secret123',
            'PASSWORD_123': 'pwd',
        }
        result = redact_log_data(data)
        # Should still detect these as sensitive
        assert result['api_key-prod'] == '[REDACTED]'
        assert result['PASSWORD_123'] == '[REDACTED]'
    
    def test_very_long_values(self):
        """Should handle very long string values."""
        long_string = 'a' * 10000
        data = {'message': long_string}
        result = redact_log_data(data)
        assert result['message'] == long_string
        
        # Very long value with PII
        long_with_pii = 'prefix-' + 'a' * 5000 + '-test@example.com-' + 'a' * 5000
        data = {'message': long_with_pii}
        result = redact_log_data(data)
        assert '[EMAIL]' in result['message']
    
    def test_max_depth_protection(self):
        """Should stop recursion at max depth."""
        # Create deeply nested structure
        data = {'level': 1}
        current = data
        for i in range(15):
            current['next'] = {'level': i + 2}
            current = current['next']
        
        result = redact_log_data(data, max_depth=5)
        assert result is not None
        # Should have stopped at depth 5
        current = result
        for _ in range(4):
            current = current.get('next')
            assert current is not None
        # Next level should be exceeded
        if 'next' in current:
            assert current['next'] == '[MAX_DEPTH_EXCEEDED]'
