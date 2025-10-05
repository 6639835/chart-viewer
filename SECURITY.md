# Security Policy

## Supported Versions

We actively support the following versions of Chart Viewer with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please follow these guidelines:

### How to Report

1. **DO NOT** create a public GitHub issue for security vulnerabilities
2. **DO** email security reports to: epa6643@gmail.com
3. **DO** include as much detail as possible about the vulnerability
4. **DO** include steps to reproduce the issue (if applicable)

### What to Include

When reporting a security vulnerability, please include:

- **Description**: Clear description of the vulnerability
- **Impact**: What the vulnerability could allow an attacker to do
- **Reproduction**: Steps to reproduce the issue
- **Environment**: OS, Node.js version, Chart Viewer version
- **Proof of concept**: If you have a proof of concept, include it
- **Suggested fix**: If you have ideas for fixing the issue

### Response Timeline

- **Acknowledgment**: We will acknowledge receipt within 48 hours
- **Initial assessment**: We will provide an initial assessment within 5 business days
- **Resolution**: We will work to resolve critical vulnerabilities within 30 days
- **Disclosure**: We will coordinate disclosure with you after a fix is available

### Responsible Disclosure

We follow responsible disclosure practices:

1. **Private reporting**: Report vulnerabilities privately first
2. **No public disclosure**: Do not publicly disclose vulnerabilities until we've had a chance to fix them
3. **Coordinated disclosure**: We will work with you to coordinate public disclosure after a fix is available
4. **Credit**: We will give appropriate credit to security researchers who report vulnerabilities responsibly

## Security Measures

### Application Security

Chart Viewer implements several security measures:

- **Input validation**: All user inputs are validated and sanitized
- **File access controls**: Restricted file system access to configured directories only
- **Path traversal protection**: Prevents directory traversal attacks
- **Content Security Policy**: Implemented where applicable
- **Secure defaults**: Application uses secure default configurations

### Dependencies

- **Regular updates**: We regularly update dependencies to address security vulnerabilities
- **Dependency scanning**: We use automated tools to scan for known vulnerabilities
- **Minimal dependencies**: We keep the dependency tree minimal to reduce attack surface

### Development Security

- **Code review**: All code changes are reviewed before merging
- **Security testing**: Security considerations are part of the development process
- **Secure coding practices**: We follow secure coding best practices

## Security Best Practices for Users

### Chart Files

- **Source verification**: Only use chart files from trusted sources
- **File integrity**: Verify file integrity when possible
- **Regular updates**: Keep chart files updated with the latest versions

### System Security

- **Keep systems updated**: Keep your operating system and Node.js updated
- **Use antivirus**: Use reputable antivirus software
- **Network security**: Use secure networks when possible
- **Backup data**: Regularly backup your chart data

### Configuration

- **Secure paths**: Use secure, non-privileged paths for chart directories
- **Access controls**: Ensure chart directories have appropriate access controls
- **Regular audits**: Regularly audit your chart file collections

## Known Security Considerations

### File System Access

Chart Viewer requires file system access to read chart files. This is necessary for the application's functionality but comes with inherent risks:

- **Directory traversal**: We implement protections against directory traversal attacks
- **File type validation**: We validate file types before processing
- **Path sanitization**: All file paths are sanitized before use

### Electron Security

As an Electron application, Chart Viewer inherits Electron's security model:

- **Context isolation**: Enabled by default
- **Node integration**: Carefully controlled
- **Remote module**: Disabled for security
- **Sandboxing**: Implemented where possible

### Network Security

- **Local server**: Chart Viewer runs a local HTTP server
- **Port binding**: Server binds to localhost only
- **No external connections**: Application does not make external network connections by default

## Security Updates

### Automatic Updates

Chart Viewer supports automatic updates through Electron's auto-updater:

- **Signed updates**: All updates are cryptographically signed
- **Integrity verification**: Update integrity is verified before installation
- **Rollback capability**: Failed updates can be rolled back

### Manual Updates

For manual updates:

1. Download updates from official sources only
2. Verify file integrity using checksums
3. Follow installation instructions carefully
4. Test the update in a safe environment first

## Contact Information

For security-related questions or concerns:

- **Email**: epa6643@gmail.com
- **Subject**: [SECURITY] Chart Viewer Security Issue
- **Response time**: We aim to respond within 48 hours

## Security Changelog

Security-related changes are documented in the main [CHANGELOG.md](CHANGELOG.md) file under the "Security" section.

## Acknowledgments

We thank the security researchers and community members who help keep Chart Viewer secure through responsible disclosure and security testing.

---

**Last updated**: January 27, 2025
