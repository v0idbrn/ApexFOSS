import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class ReadinessTest extends Model {
  static table = 'readiness_tests';

  @field('tested_at') testedAt!: number;
  @field('duration_ms') durationMs!: number;
  @field('tap_count') tapCount!: number;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
}
