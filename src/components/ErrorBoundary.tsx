import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * A render that throws used to leave an empty dark screen — the worst possible
 * answer to "why is nothing happening". Anything unexpected now lands here with
 * a sentence a viewer can act on and a button that reloads.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console keeps the detail for us; the viewer only ever sees the panel.
    console.error('[ui] render failed', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
        <h1 className="text-lg font-bold text-white">Something went wrong</h1>
        <p className="max-w-sm text-sm text-ink-mute">
          This screen could not be drawn. Reloading usually fixes it — nothing you saved is affected.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => window.location.reload()}
          data-nav="true"
        >
          Reload
        </button>
      </div>
    )
  }
}
