import { MigrationInterface, QueryRunner } from 'typeorm';

export class DemoCheckout1791849600000 implements MigrationInterface {
  name = 'DemoCheckout1791849600000';
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE demo_checkout_visits (
      id uuid PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      items jsonb NOT NULL DEFAULT '[]', version integer NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL)`);
    await runner.query(`CREATE TABLE demo_checkout_orders (
      id SERIAL PRIMARY KEY, "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now(),
      order_number varchar NOT NULL UNIQUE, visit_id uuid NOT NULL REFERENCES demo_checkout_visits(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id uuid NOT NULL,
      status varchar NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','paid','cancelled')),
      items jsonb NOT NULL, total_amount integer NOT NULL CHECK (total_amount>0), cart_version integer NOT NULL,
      store_id varchar NOT NULL, channel_key varchar NOT NULL, transaction_id varchar,
      payment_method varchar, pg_provider varchar, paid_at timestamptz, cancelled_at timestamptz,
      expires_at timestamptz NOT NULL, UNIQUE (visit_id,request_id))`);
    await runner.query(
      'CREATE INDEX demo_checkout_orders_visit_idx ON demo_checkout_orders(visit_id)'
    );
    await runner.query(
      'CREATE INDEX demo_checkout_visits_expiry_idx ON demo_checkout_visits(expires_at)'
    );
  }
  async down(runner: QueryRunner) {
    await runner.query('DROP TABLE demo_checkout_orders');
    await runner.query('DROP TABLE demo_checkout_visits');
  }
}
