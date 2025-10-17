# Contributing to Chart Viewer

Thank you for your interest in contributing to Chart Viewer! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Pull Request Process](#pull-request-process)
- [Issue Reporting](#issue-reporting)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Release Process](#release-process)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a new branch for your feature or bugfix
4. Make your changes
5. Test your changes
6. Submit a pull request

## Development Setup

### Prerequisites

- Node.js 22.0.0 or higher
- npm or yarn package manager
- Git

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/6639835/chart-viewer.git
   cd chart-viewer
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. For Electron development:
   ```bash
   npm run electron:dev
   ```

### Project Structure

```
chart-viewer/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── components/             # React components
├── electron/              # Electron main process
├── lib/                   # Utility libraries
├── public/                 # Static assets
├── scripts/               # Build and utility scripts
├── types/                 # TypeScript type definitions
└── csv/                   # Chart metadata (CSV files)
```

## How to Contribute

### Types of Contributions

We welcome several types of contributions:

- **Bug Reports**: Report bugs and issues
- **Feature Requests**: Suggest new features or improvements
- **Code Contributions**: Fix bugs or implement features
- **Documentation**: Improve documentation and examples
- **Testing**: Add or improve tests

### Bug Reports

When reporting bugs, please include:

- A clear description of the bug
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Screenshots if applicable
- Environment information (OS, Node.js version, etc.)

### Feature Requests

When requesting features, please include:

- A clear description of the feature
- Use cases and motivation
- Any potential implementation ideas
- Any potential drawbacks or considerations

## Pull Request Process

### Before Submitting

1. **Check existing issues**: Make sure your issue isn't already reported
2. **Create an issue**: For significant changes, create an issue first
3. **Fork and branch**: Create a feature branch from `main`
4. **Follow coding standards**: Ensure your code follows project conventions
5. **Test thoroughly**: Test your changes across different scenarios
6. **Update documentation**: Update relevant documentation if needed

### Pull Request Guidelines

1. **Clear title**: Use a descriptive title
2. **Detailed description**: Explain what changes you made and why
3. **Reference issues**: Link to related issues using `Fixes #123` or `Closes #123`
4. **Small, focused changes**: Keep PRs focused on a single feature or bugfix
5. **Clean commit history**: Use clear, descriptive commit messages

### Pull Request Template

When creating a pull request, please include:

- **Description**: What does this PR do?
- **Type of change**: Bug fix, feature, documentation, etc.
- **Testing**: How was this tested?
- **Breaking changes**: Any breaking changes?
- **Checklist**: Confirm all requirements are met

## Issue Reporting

### Bug Reports

Use the bug report template and include:

- **Environment**: OS, Node.js version, browser (if applicable)
- **Steps to reproduce**: Clear, numbered steps
- **Expected behavior**: What should happen
- **Actual behavior**: What actually happens
- **Additional context**: Screenshots, logs, etc.

### Feature Requests

Use the feature request template and include:

- **Problem**: What problem does this solve?
- **Solution**: Describe your proposed solution
- **Alternatives**: Any alternative solutions considered
- **Additional context**: Any other relevant information

## Coding Standards

### TypeScript/JavaScript

- Use TypeScript for all new code
- Follow existing code style and patterns
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Use ESLint and Prettier for code formatting

### React Components

- Use functional components with hooks
- Follow React best practices
- Use TypeScript interfaces for props
- Keep components focused and reusable

### CSS/Styling

- Use Tailwind CSS for styling
- Follow responsive design principles
- Use semantic class names
- Maintain dark/light theme support

### File Organization

- Place components in appropriate directories
- Use descriptive file names
- Group related functionality together
- Keep files focused and not too large

## Testing

### Manual Testing

Before submitting a PR, please test:

- [ ] Application starts correctly
- [ ] All features work as expected
- [ ] No console errors or warnings
- [ ] Responsive design works on different screen sizes
- [ ] Dark/light theme switching works
- [ ] Electron app builds and runs correctly

### Testing Checklist

- [ ] Test on different operating systems (if possible)
- [ ] Test with different chart file formats
- [ ] Test error handling scenarios
- [ ] Test performance with large chart collections
- [ ] Test accessibility features

## Release Process

### Version Numbering

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Release Steps

1. Update version in `package.json`
2. Update `CHANGELOG.md` with new features/fixes
3. Create a release tag
4. Build and test the release
5. Publish to GitHub Releases

## Getting Help

If you need help or have questions:

- **Issues**: Use GitHub Issues for bug reports and feature requests
- **Discussions**: Use GitHub Discussions for general questions
- **Email**: Contact epa6643@gmail.com for direct communication

## Recognition

Contributors will be recognized in:

- GitHub contributors list
- Release notes
- Project documentation

Thank you for contributing to Chart Viewer! 🚀
