import { Component } from "react";

/**
 * Catches JavaScript errors in any child component tree and displays a
 * fallback UI instead of crashing the entire app with a white screen.
 * Especially important with 40+ lazy-loaded pages where a single chunk
 * error could otherwise take down the whole application.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Check if it's a chunk loading error (lazy import failed)
      const isChunkError =
        this.state.error?.message?.includes("Loading chunk") ||
        this.state.error?.message?.includes("Failed to fetch dynamically imported module") ||
        this.state.error?.name === "ChunkLoadError";

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="text-5xl">
              {isChunkError ? "\u26A0\uFE0F" : "\u274C"}
            </div>
            <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
              {isChunkError
                ? "Page failed to load"
                : "Something went wrong"}
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              {isChunkError
                ? "A new version may have been deployed. Please reload the page."
                : "An unexpected error occurred. You can try again or reload the page."}
            </p>
            <div className="flex gap-3 justify-center pt-2">
              {!isChunkError && (
                <button
                  onClick={this.handleRetry}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  Try Again
                </button>
              )}
              <button
                onClick={this.handleReload}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
              >
                Reload Page
              </button>
            </div>
            {import.meta.env.DEV && this.state.error && (
              <details className="mt-4 text-left text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded p-3">
                <summary className="cursor-pointer font-medium">Error details</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words">
                  {this.state.error.message}
                  {"\n"}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
