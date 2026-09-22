import { Component, signal } from '@angular/core';
import { invoke } from '@pc-nexus/bridge';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly result = signal<string | null>(null);

  constructor() {
    this.runGreeting();
  }

  protected runGreeting() {
    invoke<string, string>('greeting', 'Nexus')
      .then((res: string) => this.result.set(res))
      .catch((err: Error) => this.result.set(`Error: ${err}`));
  }
}
