"use client"

import { Component, type ErrorInfo, type ReactNode } from "react"

type Props = {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
  label?: string
}

type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const tag = this.props.label ? `[ErrorBoundary:${this.props.label}]` : "[ErrorBoundary]"
    // eslint-disable-next-line no-console
    console.error(`${tag} ${error.name}: ${error.message}`)
    // eslint-disable-next-line no-console
    console.error(`${tag} stack:\n${error.stack ?? "(no stack)"}`)
    if (info.componentStack) {
      // eslint-disable-next-line no-console
      console.error(`${tag} componentStack:${info.componentStack}`)
    }
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset)
      return (
        <div
          role="alert"
          className="flex h-full min-h-64 w-full flex-col items-center justify-center gap-3 bg-background p-6 font-mono text-xs text-foreground"
        >
          <div className="text-[10px] uppercase tracking-[0.18em] text-red-400">
            {this.props.label ?? "组件"}崩溃
          </div>
          <div className="max-w-lg break-all text-center text-sm">
            {this.state.error.name}: {this.state.error.message}
          </div>
          <pre className="max-h-48 max-w-2xl overflow-auto rounded border border-border bg-card p-3 text-[10px] leading-relaxed text-muted-foreground">
            {this.state.error.stack ?? "(no stack)"}
          </pre>
          <button
            type="button"
            onClick={this.reset}
            className="rounded-md border border-border bg-card px-3 py-1 text-[11px] hover:bg-accent"
          >
            重试
          </button>
          <div className="text-[10px] text-muted-foreground">
            完整错误栈已打印到浏览器控制台。
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
