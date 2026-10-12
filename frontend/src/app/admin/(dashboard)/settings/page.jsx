"use client";

import { Settings } from "lucide-react";

export default function AdminSettingsPage() {
  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="panel-chip">
          <Settings size={18} />
        </span>
        <h2 className="panel-title">Settings</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="admin-store-name" className="panel-strong mb-1 block text-sm font-medium">
            Store name
          </label>
          <input id="admin-store-name" className="input-field" defaultValue="TechStore" />
        </div>
        <div>
          <label
            htmlFor="admin-support-email"
            className="panel-strong mb-1 block text-sm font-medium"
          >
            Support email
          </label>
          <input id="admin-support-email" className="input-field" defaultValue="support@techstore.test" />
        </div>
        <label className="panel-muted flex items-center gap-3 text-sm">
          <input type="checkbox" defaultChecked className="accent-primary" />
          Notify admin when a new order arrives
        </label>
        <label className="panel-muted flex items-center gap-3 text-sm">
          <input type="checkbox" defaultChecked className="accent-primary" />
          Show low-stock warnings on dashboard
        </label>
      </div>
    </section>
  );
}
