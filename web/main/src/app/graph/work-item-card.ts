import {
  ApplicationRef,
  Component,
  type ComponentRef,
  type EnvironmentInjector,
  computed,
  createComponent,
  input,
} from '@angular/core';
import { type Group } from '@antv/g';
import {
  ExtensionCategory,
  HTML,
  register,
  type HTMLStyleProps,
} from '@antv/g6';
import { ThyAvatar, ThyAvatarService, ThyDefaultAvatarService } from 'ngx-tethys/avatar';
import { ThyIcon } from 'ngx-tethys/icon';
import type { GraphEntity } from '../entities/graph.entity';
import { entityAssigneeName } from '../utils/graph.util';

let environmentInjector: EnvironmentInjector | null = null;
let applicationRef: ApplicationRef | null = null;

/** 图初始化前注入，HTML 节点才能创建这个组件。 */
export function bindWorkItemCardRuntime(
  injector: EnvironmentInjector,
  appRef: ApplicationRef,
): void {
  environmentInjector = injector;
  applicationRef = appRef;
}

@Component({
  selector: 'app-work-item-card',
  imports: [ThyIcon, ThyAvatar],
  providers: [{ provide: ThyAvatarService, useClass: ThyDefaultAvatarService }],
  templateUrl: './work-item-card.html',
  styleUrl: './work-item-card.scss',
})
export class WorkItemCard {
  readonly item = input.required<GraphEntity>();
  readonly fold = input('right');
  readonly root = input(false);

  protected readonly assignee = computed(() => entityAssigneeName(this.item()));
}

/** 把 app-work-item-card 挂到 G6 的 HTML 节点上。 */
class WorkItemCardNode extends HTML {
  private view: ComponentRef<WorkItemCard> | null = null;

  override render(attributes?: Required<HTMLStyleProps>, container?: Group): void {
    const style = attributes ?? this.parsedAttributes;
    const host = container ?? this;
    const item = this.itemOf();
    const [width = 200, height = 56] = this.getSize(style);
    if (!item || item.relationHub || !environmentInjector || !applicationRef) {
      this.destroyView();
      super.render({ ...style, innerHTML: '', dx: 0, dy: 0 }, host);
      return;
    }

    if (!this.view) {
      this.view = createComponent(WorkItemCard, { environmentInjector });
      applicationRef.attachView(this.view.hostView);
    }
    const states = new Set(this.context.graph.getElementState(this.id) ?? []);
    this.view.setInput('item', item);
    this.view.setInput('fold', this.foldOf());
    this.view.setInput('root', states.has('root'));
    this.view.changeDetectorRef.detectChanges();

    super.render(
      {
        ...style,
        innerHTML: this.view.location.nativeElement,
        dx: -width / 2,
        dy: -height / 2,
      },
      host,
    );
  }

  override destroy(): void {
    this.destroyView();
    super.destroy();
  }

  private itemOf(): GraphEntity | undefined {
    return this.context.graph.getNodeData(this.id)?.data?.['item'] as GraphEntity | undefined;
  }

  private foldOf(): string {
    const fold = this.context.graph.getNodeData(this.id)?.data?.['foldPlacement'];
    return typeof fold === 'string' ? fold : 'right';
  }

  private destroyView(): void {
    if (!this.view) {
      return;
    }
    applicationRef?.detachView(this.view.hostView);
    this.view.destroy();
    this.view = null;
  }
}

register(ExtensionCategory.NODE, 'work-item-card', WorkItemCardNode);
