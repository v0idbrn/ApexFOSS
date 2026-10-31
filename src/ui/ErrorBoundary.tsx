import { Component, Fragment, type ReactNode } from 'react';
import { strings } from '../constants/strings';
import { ErrorState } from './components';

interface Props {
  children: ReactNode;
}

/**
 * Release-build crash boundary: an uncaught render error previously exited the
 * app to the launcher with no in-app recovery (KNOWN_LIMITATIONS #22). Shows a
 * localized fallback; "restart interface" remounts the whole tree with a key,
 * which also resets the Navigator to its initial stacks (Home) — a crash inside
 * one screen must not loop forever on remount. No reporting: errors never
 * leave the device (privacy by design).
 */
export class ErrorBoundary extends Component<Props, { crashed: boolean; cycle: number }> {
  state = { crashed: false, cycle: 0 };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch() {
    // Intentionally silent — no telemetry, nothing to log off-device.
  }

  private restart = () => {
    this.setState((s) => ({ crashed: false, cycle: s.cycle + 1 }));
  };

  render() {
    if (this.state.crashed) {
      return (
        <ErrorState
          message={`${strings.crash.title}\n\n${strings.crash.body}`}
          onRetry={this.restart}
        />
      );
    }
    return <Fragment key={this.state.cycle}>{this.props.children}</Fragment>;
  }
}
