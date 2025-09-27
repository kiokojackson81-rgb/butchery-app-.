"use client";
import React from "react";

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: unknown) {
    // Optional: hook into your client logger here
    console.error("Client error:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16 }}>
          <h3>Something went wrong</h3>
          <p>Try reloading the page. If this keeps happening, please contact support.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
