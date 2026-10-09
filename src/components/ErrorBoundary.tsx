import { Component, ReactNode } from 'react';
import { friendlyError } from '@/lib/friendlyError';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[ErrorBoundary]', error, info);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-logic-bg-deep text-logic-text px-6 text-center">
          <div className="max-w-md">
            <h1 className="text-lg font-semibold mb-2 text-logic-lcd-green">Algo deu errado</h1>
            <p className="text-sm text-logic-text-muted mb-4">
              O painel foi recuperado após um erro inesperado. Seu projeto está preservado em memória.
            </p>
            <pre className="text-2xs text-logic-text-muted bg-logic-bg-elevated border border-logic-border-dark rounded px-3 py-2 mb-4 overflow-auto max-h-32 text-left">
{friendlyError(this.state.error, 'Ocorreu um erro inesperado na tela.')}
            </pre>
            <button
              className="logic-btn-accent px-4 py-2 text-sm"
              onClick={this.handleRetry}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
