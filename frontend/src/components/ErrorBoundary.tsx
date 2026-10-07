import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a render error in its subtree and shows a plain message instead of
 * a blank screen. Used where the server's payload can be a version off from
 * what the page expects.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; message: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return <p role="alert" className="rounded-lg border border-border bg-surface-1 p-3 text-sm text-muted">{this.props.message}</p>;
    }
    return this.props.children;
  }
}
