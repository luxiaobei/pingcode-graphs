import { Component, computed, input, output } from '@angular/core';
import { NavigationTarget, router } from '@pc-nexus/bridge';
import {
  GraphWorkItem,
  workItemAssigneeName,
  workItemTypeName,
} from './graph.types';

@Component({
  selector: 'app-node-detail',
  templateUrl: './node-detail.html',
  styleUrl: './node-detail.scss',
})
export class NodeDetail {
  readonly item = input<GraphWorkItem | null>(null);
  readonly isRoot = input(false);
  readonly isOnCriticalPath = input(false);
  readonly close = output<void>();

  protected readonly typeName = computed(() => workItemTypeName(this.item()));
  protected readonly assigneeName = computed(() => workItemAssigneeName(this.item()));

  protected openWorkItem(): void {
    const id = this.item()?.id;
    if (!id) {
      return;
    }
    void router.open({ target: NavigationTarget.Workitem, id });
  }
}
