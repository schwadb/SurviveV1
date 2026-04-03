import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('WatcherV1 ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card border-red-900/50 bg-red-900/10">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-300 font-semibold text-sm">
                {this.props.fallbackTitle ?? 'Component Error'}
              </p>
              <p className="text-red-400/70 text-xs mt-1">
                {this.state.error?.message ?? 'An unexpected error occurred.'}
              </p>
              <p className="text-gray-600 text-xs mt-2">
                This component encountered an error and has been isolated to prevent crashing the app.
              </p>
            </div>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="btn-secondary text-xs flex-shrink-0"
            >
              <RefreshCw size={12} />
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
