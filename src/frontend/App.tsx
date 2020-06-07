import * as React from 'react';
import { render } from 'react-dom';

interface AppProps {
    name: string;
}

interface AppState {
    time: string;
    about: string;
}

export class App extends React.Component<AppProps, AppState> {
    constructor(props: AppProps) {
        super(props);
        this.state = {
            time: null,
            about: null,
        };
    }

    componentDidMount() {
        this.getTime();
        setInterval(this.getTime, 2000);
        this.getAbout();
    }

    render() {
        const { name } = this.props;
        const { time } = this.state;
        const { about } = this.state;
        return (
            <>
                <h1>{name}</h1>
                <div>{time}</div>
                <div>{about}</div>
            </>
        );
    }

    private getTime = async () => {
        const response = await fetch('/api/time', { method: 'GET' });
        if (response.ok) {
            this.setState({ time: await response.text() });
        }
    };

    private getAbout = async () => {
        const response = await fetch('/api/about', { method: 'GET' });
        if (response.ok) {
            this.setState({ about: await response.text() });
        }
    };
}

export function start() {
    const rootElem = document.getElementById('main');
    render(<App name="Mail Scanner" />, rootElem);
}
