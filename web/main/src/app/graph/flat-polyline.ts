import { ExtensionCategory, Polyline, register } from '@antv/g6';

type Point = [number, number];

/** 裁短后的描线。label 把文案钉回裁短前的位置。 */
const plans = new Map<string, { points: Point[]; label?: Point }>();

/** 悬停时整段描出，盖住共用主干，而不是只染分叉后的那一截。 */
const fullStrokes = new Set<string>();

export function setFullStrokeEdges(ids: Iterable<string>): void {
  fullStrokes.clear();
  for (const id of ids) {
    fullStrokes.add(id);
  }
}

export function resetStrokePlans(): void {
  plans.clear();
}

export function planStroke(id: string, points: Point[], label?: Point): void {
  plans.set(id, { points, label });
}

/** 共用主干只描一次，其余边从分叉处接着画。 */
class FlatPolyline extends Polyline {
  protected override getPoints(
    attributes: Parameters<Polyline['getKeyPath']>[0],
  ): ReturnType<Polyline['getPoints']> {
    if (this.id && fullStrokes.has(this.id)) {
      return super.getPoints(attributes);
    }
    const planned = this.plan()?.points;
    if (planned && planned.length >= 2) {
      return planned as ReturnType<Polyline['getPoints']>;
    }
    return super.getPoints(attributes);
  }

  protected override getLabelStyle(
    attributes: Parameters<Polyline['getLabelStyle']>[0],
  ): ReturnType<Polyline['getLabelStyle']> {
    const style = super.getLabelStyle(attributes);
    const at = this.plan()?.label;
    if (!style || !at) {
      return style;
    }
    return { ...style, transform: [['translate', at[0], at[1]]] };
  }

  private plan() {
    return this.id ? plans.get(this.id) : undefined;
  }
}

register(ExtensionCategory.EDGE, 'flat-polyline', FlatPolyline);
