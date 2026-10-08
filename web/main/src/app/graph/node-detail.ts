import { Component, computed, input, output } from '@angular/core';
import { router } from '@pc-nexus/bridge';
import type { GraphEntity } from '../entities/graph.entity';
import {
  entityAssigneeName,
  entityScopeName,
  entityTypeName,
  resolveNavigationTarget,
} from '../utils/graph.util';

@Component({
  selector: 'app-node-detail',
  templateUrl: './node-detail.html',
  styleUrl: './node-detail.scss',
})
export class NodeDetail {
  readonly item = input<GraphEntity | null>(null);
  readonly isRoot = input(false);
  readonly isOnCriticalPath = input(false);
  readonly close = output<void>();

  protected readonly typeName = computed(() => entityTypeName(this.item()));
  protected readonly assigneeName = computed(() => entityAssigneeName(this.item()));
  protected readonly scopeName = computed(() => entityScopeName(this.item()));

  protected openEntity(): void {
    const current = this.item();
    if (!current?.id) {
      return;
    }
    const target = resolveNavigationTarget(current);
    if (!target) {
      return;
    }
    void router.open({ target, id: current.id });
  }
}
