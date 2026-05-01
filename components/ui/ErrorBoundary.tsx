'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Optional label for logging context */
  surface?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Generic React Error Boundary for catching render errors.
 * Prevents full-page crashes by displaying a friendly fallback UI.
 * 
 * Usage:
 *   <ErrorBoundary surface="DesignStudio">
 *     <DesignStudio />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const surface = this.props.surface ?? 'unknown';
    console.error(`[ErrorBoundary:${surface}]`, error.message, errorInfo.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const surface = this.props.surface ?? 'This section';
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: 200, padding: 32,
          background: 'rgba(239,68,68,0.05)', borderRadius: 12,
          border: '1px solid rgba(239,68,68,0.2)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <h3 style={{ color: '#f87171', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            {surface} encountered an error
          </h3>
          <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16, textAlign: 'center', maxWidth: 400 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: 'rgba(239,68,68,0.15)', color: '#f87171',
              border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}