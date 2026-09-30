import React, { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
          <h1 className="text-4xl font-bold mb-4">Oops, something went wrong.</h1>
          <p className="text-lg mb-8 opacity-80">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <Button onClick={() => window.location.reload()} size="lg">
            Reload Page
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
