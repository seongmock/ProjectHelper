import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ errorInfo });
        console.error("Uncaught error:", error, errorInfo);
    }

    handleClearData = () => {
        if (window.confirm('모든 데이터가 삭제됩니다. 계속하시겠습니까?')) {
            localStorage.clear();
            window.location.reload();
        }
    };

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    padding: '20px',
                    textAlign: 'center',
                    fontFamily: 'sans-serif',
                    maxWidth: '600px',
                    margin: '50px auto',
                    border: '1px solid #ffcccc',
                    borderRadius: '8px',
                    backgroundColor: '#fff5f5'
                }}>
                    <h2 style={{ color: '#cc0000' }}>오류가 발생했습니다</h2>
                    <p>죄송합니다. 애플리케이션을 실행하는 도중 문제가 발생했습니다.</p>
                    <details style={{ whiteSpace: 'pre-wrap', textAlign: 'left', margin: '20px 0', padding: '10px', background: '#f8f8f8', border: '1px solid #ddd' }}>
                        {this.state.error && this.state.error.toString()}
                        <br />
                        {this.state.errorInfo && this.state.errorInfo.componentStack}
                    </details>
                    <div style={{ marginTop: '20px' }}>
                        <button
                            onClick={() => window.location.reload()}
                            style={{
                                padding: '8px 16px',
                                marginRight: '10px',
                                backgroundColor: '#4A90E2',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            새로고침
                        </button>
                        <button
                            onClick={this.handleClearData}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: '#e74c3c',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            데이터 초기화 (복구)
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
