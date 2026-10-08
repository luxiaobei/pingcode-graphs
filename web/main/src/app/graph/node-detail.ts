import { Component, computed, input, output } from '@angular/core';
import { NavigationTarget, router } from '@pc-nexus/bridge';
import type { GraphWorkItem } from '../entities/graph.entity';
import { workItemAssigneeName, workItemTypeName } from '../utils/graph.util';

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
