import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Database, 
  Zap, 
  Plus, 
  Trash2, 
  Clock, 
  RefreshCw,
  Server,
  Cpu,
  Globe,
  Search,
  Flame,
  CheckCircle2,
  ListTodo,
  Layers,
  Sparkles,
  ArrowRight,
  ShieldCheck
} from 'lucide-react';

export default function App() {
  // 1. Navigation Tab State ('dashboard' | 'items' | 'jobs')
  const [activeTab, setActiveTab] = useState('dashboard');

  // 2. Health Monitor State
  const [health, setHealth] = useState({
    frontend: 'healthy',
    api: 'checking',
    worker: 'checking',
    database: 'checking',
    redis: 'checking'
  });

  // 3. Data States
  const [items, setItems] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobTriggering, setJobTriggering] = useState(false);
  const [purgingCache, setPurgingCache] = useState(false);

  // 4. Form States
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('pending');

  // 5. Filter & Search States
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // 6. Cache & Latency Tracker States
  const [cacheStatus, setCacheStatus] = useState(null); // 'HIT' | 'MISS'
  const [cacheSource, setCacheSource] = useState(null); // 'Redis' | 'PostgreSQL'
  const [latency, setLatency] = useState(null); // in ms

  // Check Health Status of Services
  const checkHealth = async () => {
    try {
      const res = await fetch('/healthz');
      if (res.ok) {
        const data = await res.json();
        setHealth(prev => ({
          ...prev,
          api: data.status === 'healthy' ? 'healthy' : 'unhealthy',
          database: data.database === 'connected' ? 'healthy' : 'unhealthy',
          redis: data.redis === 'connected' ? 'healthy' : 'unhealthy'
        }));
      } else {
        setHealth(prev => ({ ...prev, api: 'unhealthy', database: 'unhealthy', redis: 'unhealthy' }));
      }
    } catch (err) {
      setHealth(prev => ({ ...prev, api: 'unhealthy', database: 'unhealthy', redis: 'unhealthy' }));
    }
  };

  // Fetch Items with Latency Tracking and X-Cache Header Inspection
  const fetchItems = async () => {
    setLoadingItems(true);
    const startTime = performance.now();
    try {
      let url = '/api/items?';
      if (statusFilter !== 'all') url += `status=${encodeURIComponent(statusFilter)}&`;
      if (searchQuery.trim()) url += `q=${encodeURIComponent(searchQuery.trim())}`;

      const res = await fetch(url);
      const endTime = performance.now();
      setLatency(Math.round(endTime - startTime));

      const cacheHeader = res.headers.get('X-Cache') || 'MISS';
      const sourceHeader = res.headers.get('X-Cache-Source') || (cacheHeader === 'HIT' ? 'Redis' : 'PostgreSQL');

      setCacheStatus(cacheHeader);
      setCacheSource(sourceHeader);

      if (res.ok) {
        const data = await res.json();
        setItems(data || []);
      }
    } catch (err) {
      console.error('Error fetching items:', err);
    } finally {
      setLoadingItems(false);
    }
  };

  // Fetch Async Background Jobs List
  const fetchJobs = async () => {
    setLoadingJobs(true);
    try {
      const res = await fetch('/api/jobs');
      if (res.ok) {
        const data = await res.json();
        setJobs(data || []);
        const hasPending = (data || []).some(j => j.status === 'pending' || j.status === 'processing');
        setHealth(prev => ({ ...prev, worker: 'healthy' }));
        if (hasPending) {
          setTimeout(fetchJobs, 2000);
        }
      }
    } catch (err) {
      console.error('Error fetching jobs:', err);
    } finally {
      setLoadingJobs(false);
    }
  };

  // Initial load & Polling
  useEffect(() => {
    checkHealth();
    fetchItems();
    fetchJobs();
    const interval = setInterval(() => {
      checkHealth();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch data on Tab Change
  useEffect(() => {
    if (activeTab === 'dashboard') {
      fetchItems();
      fetchJobs();
    } else if (activeTab === 'items') {
      fetchItems();
    } else if (activeTab === 'jobs') {
      fetchJobs();
    }
  }, [activeTab, statusFilter, searchQuery]);

  // Create Item
  const handleCreateItem = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    const startTime = performance.now();
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, status }),
      });
      setLatency(Math.round(performance.now() - startTime));

      if (res.ok) {
        setTitle('');
        setDescription('');
        setStatus('pending');
        fetchItems();
      }
    } catch (err) {
      console.error('Error creating item:', err);
    }
  };

  // Update Status of Item
  const handleUpdateStatus = async (id, currentStatus) => {
    const nextStatusMap = { 'pending': 'in-progress', 'in-progress': 'completed', 'completed': 'pending' };
    const newStatus = nextStatusMap[currentStatus] || 'pending';

    const startTime = performance.now();
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      setLatency(Math.round(performance.now() - startTime));

      if (res.ok) {
        fetchItems();
      }
    } catch (err) {
      console.error('Error updating item status:', err);
    }
  };

  // Delete Item
  const handleDeleteItem = async (id) => {
    const startTime = performance.now();
    try {
      const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
      setLatency(Math.round(performance.now() - startTime));
      if (res.ok) {
        fetchItems();
      }
    } catch (err) {
      console.error('Error deleting item:', err);
    }
  };

  // One-Click Cache Invalidator
  const handlePurgeCache = async () => {
    setPurgingCache(true);
    const startTime = performance.now();
    try {
      const res = await fetch('/api/cache/purge', { method: 'POST' });
      setLatency(Math.round(performance.now() - startTime));
      if (res.ok) {
        fetchItems();
      }
    } catch (err) {
      console.error('Error purging cache:', err);
    } finally {
      setPurgingCache(false);
    }
  };

  // Trigger Background Job
  const handleTriggerJob = async () => {
    setJobTriggering(true);
    const startTime = performance.now();
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'generate_report' }),
      });
      setLatency(Math.round(performance.now() - startTime));
      if (res.ok) {
        fetchJobs();
      }
    } catch (err) {
      console.error('Error triggering job:', err);
    } finally {
      setJobTriggering(false);
    }
  };

  // Summary Stat Calculations
  const totalItems = items.length;
  const pendingCount = items.filter(i => i.status === 'pending').length;
  const completedCount = items.filter(i => i.status === 'completed').length;

  return (
    <div className="app-layout">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Layers size={26} style={{ color: 'var(--accent-blue)' }} />
          <span>MicroServices</span>
        </div>

        <nav className="sidebar-menu">
          <div 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Activity size={18} /> Dashboard
          </div>
          <div 
            className={`nav-item ${activeTab === 'items' ? 'active' : ''}`}
            onClick={() => setActiveTab('items')}
          >
            <ListTodo size={18} /> Items Manager
          </div>
          <div 
            className={`nav-item ${activeTab === 'jobs' ? 'active' : ''}`}
            onClick={() => setActiveTab('jobs')}
          >
            <Cpu size={18} /> Background Jobs
          </div>
        </nav>
      </aside>

      {/* Main Wrapper */}
      <main className="main-wrapper">
        {/* Top Header with Live System Health Monitor Badges */}
        <header className="top-header">
          <div className="header-title">
            <h1>
              <Sparkles size={24} style={{ color: 'var(--accent-blue)' }} /> Microservices Dashboard
            </h1>
            <p>React + FastAPI + Python Worker + Redis Cache/Queue + PostgreSQL 16</p>
          </div>

          <div className="health-grid">
            <div className="health-badge">
              <span className={`status-dot ${health.frontend}`} />
              <Globe size={13} /> Frontend
            </div>
            <div className="health-badge">
              <span className={`status-dot ${health.api}`} />
              <Server size={13} /> FastAPI API
            </div>
            <div className="health-badge">
              <span className={`status-dot ${health.worker}`} />
              <Cpu size={13} /> Async Worker
            </div>
            <div className="health-badge">
              <span className={`status-dot ${health.database}`} />
              <Database size={13} /> PostgreSQL
            </div>
            <div className="health-badge">
              <span className={`status-dot ${health.redis}`} />
              <Zap size={13} /> Redis Cache
            </div>
          </div>
        </header>

        {/* Summary Statistics Cards */}
        <section className="stats-grid">
          <div className="stat-card">
            <div className="stat-header">
              <span>Total Items</span>
              <ListTodo size={16} />
            </div>
            <div className="stat-value">{totalItems}</div>
          </div>

          <div className="stat-card">
            <div className="stat-header">
              <span>Pending Tasks</span>
              <Clock size={16} style={{ color: 'var(--accent-amber)' }} />
            </div>
            <div className="stat-value" style={{ color: 'var(--accent-amber)' }}>{pendingCount}</div>
          </div>

          <div className="stat-card">
            <div className="stat-header">
              <span>Completed</span>
              <CheckCircle2 size={16} style={{ color: 'var(--accent-emerald)' }} />
            </div>
            <div className="stat-value" style={{ color: 'var(--accent-emerald)' }}>{completedCount}</div>
          </div>

          <div className="stat-card">
            <div className="stat-header">
              <span>Async Jobs</span>
              <Cpu size={16} style={{ color: 'var(--accent-purple)' }} />
            </div>
            <div className="stat-value" style={{ color: 'var(--accent-purple)' }}>{jobs.length}</div>
          </div>
        </section>

        {/* ========================================================= */}
        {/* TAB 1: DASHBOARD VIEW                                      */}
        {/* ========================================================= */}
        {activeTab === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Quick Actions Panel */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
              <div className="card-panel">
                <div className="panel-title">
                  <ListTodo size={18} style={{ color: 'var(--accent-blue)' }} /> Items Management
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Manage CRUD tasks backed by PostgreSQL with automatic Redis cache-aside reads.
                </p>
                <button className="btn-primary" onClick={() => setActiveTab('items')} style={{ marginTop: 'auto' }}>
                  Manage Items <ArrowRight size={16} />
                </button>
              </div>

              <div className="card-panel">
                <div className="panel-title">
                  <Cpu size={18} style={{ color: 'var(--accent-purple)' }} /> Background Worker
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Trigger asynchronous background report tasks pushed to Redis queue.
                </p>
                <button className="btn-secondary btn-purple" onClick={handleTriggerJob} disabled={jobTriggering} style={{ marginTop: 'auto' }}>
                  <Cpu size={16} /> {jobTriggering ? 'Queuing...' : 'Trigger Async Job'}
                </button>
              </div>

              <div className="card-panel">
                <div className="panel-title">
                  <Flame size={18} style={{ color: 'var(--accent-amber)' }} /> Cache Control
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Instantly purge Redis cache key to test cache-miss fallback reads.
                </p>
                <button className="btn-secondary btn-amber" onClick={handlePurgeCache} disabled={purgingCache} style={{ marginTop: 'auto' }}>
                  <Flame size={16} /> {purgingCache ? 'Purging...' : 'Purge Redis Cache'}
                </button>
              </div>
            </div>

            {/* Microservices Health & Topology Table */}
            <section className="card-panel">
              <div className="panel-header">
                <h2 className="panel-title">
                  <ShieldCheck size={18} /> Microservice Topology & Status Matrix
                </h2>
                <button className="btn-secondary" onClick={checkHealth}>
                  <RefreshCw size={14} /> Refresh Matrix
                </button>
              </div>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>Microservice</th>
                    <th>Container Name</th>
                    <th>Port</th>
                    <th>Runtime Tech</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Frontend Web</strong></td>
                    <td><code>microservice-frontend</code></td>
                    <td>80:8080</td>
                    <td>React 18 + Nginx</td>
                    <td><span className={`status-tag ${health.frontend}`}>{health.frontend}</span></td>
                  </tr>
                  <tr>
                    <td><strong>API Backend</strong></td>
                    <td><code>microservice-backend</code></td>
                    <td>8000</td>
                    <td>FastAPI + Uvicorn</td>
                    <td><span className={`status-tag ${health.api}`}>{health.api}</span></td>
                  </tr>
                  <tr>
                    <td><strong>Async Worker</strong></td>
                    <td><code>microservice-worker</code></td>
                    <td>8002</td>
                    <td>Python Daemon + BLPOP</td>
                    <td><span className={`status-tag ${health.worker}`}>{health.worker}</span></td>
                  </tr>
                  <tr>
                    <td><strong>PostgreSQL Database</strong></td>
                    <td><code>microservice-postgres</code></td>
                    <td>5432</td>
                    <td>PostgreSQL 16 Alpine</td>
                    <td><span className={`status-tag ${health.database}`}>{health.database}</span></td>
                  </tr>
                  <tr>
                    <td><strong>Redis Cache & Queue</strong></td>
                    <td><code>microservice-redis</code></td>
                    <td>6379</td>
                    <td>Redis 7 Alpine</td>
                    <td><span className={`status-tag ${health.redis}`}>{health.redis}</span></td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: ITEMS MANAGER VIEW                                  */}
        {/* ========================================================= */}
        {activeTab === 'items' && (
          <div className="sections-grid">
            {/* Left Column: Create Form & Cache Purge */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <section className="card-panel">
                <div className="panel-header">
                  <h2 className="panel-title">
                    <Plus size={18} /> Create New Item
                  </h2>
                </div>

                <form onSubmit={handleCreateItem} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="form-group">
                    <label htmlFor="title">Title</label>
                    <input
                      id="title"
                      type="text"
                      placeholder="e.g. Audit Redis Cache Hits"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="description">Description</label>
                    <textarea
                      id="description"
                      rows="3"
                      placeholder="Task description..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="status">Initial Status</label>
                    <select
                      id="status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="pending">Pending</option>
                      <option value="in-progress">In Progress</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>

                  <button type="submit" className="btn-primary">
                    <Plus size={16} /> Save & Invalidate Cache
                  </button>
                </form>
              </section>

              <section className="card-panel">
                <div className="panel-header">
                  <h2 className="panel-title">
                    <Flame size={18} /> Cache Management
                  </h2>
                </div>

                <button 
                  className="btn-secondary btn-amber" 
                  onClick={handlePurgeCache} 
                  disabled={purgingCache}
                >
                  <Flame size={16} /> {purgingCache ? 'Purging Cache...' : 'One-Click Purge Redis Cache'}
                </button>
              </section>
            </div>

            {/* Right Column: Search, Filter, Cache Banner & Items Cards */}
            <section className="card-panel">
              <div className="panel-header">
                <h2 className="panel-title">
                  <ListTodo size={18} /> Items List
                </h2>

                <button className="btn-secondary" onClick={fetchItems} disabled={loadingItems}>
                  <RefreshCw size={14} className={loadingItems ? 'spin' : ''} /> Refresh
                </button>
              </div>

              {/* Styled Filter Bar */}
              <div className="filter-bar">
                <div className="search-input-wrapper">
                  <Search size={16} className="search-icon" />
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Search title or description..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <select
                  className="status-select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="processing">Processing</option>
                  <option value="completed">Completed</option>
                </select>
              </div>

              {/* Cache Hit/Miss Banner */}
              {cacheStatus && (
                <div className="cache-banner">
                  <span className={`cache-badge ${cacheStatus.toLowerCase()}`}>
                    REDIS {cacheStatus}
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Clock size={13} /> Latency: <span className="latency-badge">{latency} ms</span>
                  </div>

                  <div style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Source: <strong style={{ color: 'var(--text-primary)' }}>{cacheSource}</strong>
                  </div>
                </div>
              )}

              {/* Items Cards */}
              <div className="items-list">
                {items.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    No items found matching criteria.
                  </div>
                ) : (
                  items.map((item) => (
                    <div key={item.id} className="item-card">
                      <div className="item-info">
                        <h3>#{item.id} {item.title}</h3>
                        {item.description && <p>{item.description}</p>}
                        <div className="item-meta">
                          <span 
                            className={`status-tag ${item.status}`} 
                            onClick={() => handleUpdateStatus(item.id, item.status)}
                            style={{ cursor: 'pointer' }}
                            title="Click to cycle status"
                          >
                            {item.status}
                          </span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {new Date(item.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>

                      <div className="item-actions">
                        <button 
                          className="btn-icon" 
                          onClick={() => handleDeleteItem(item.id)}
                          title="Delete item"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: BACKGROUND JOBS VIEW                                */}
        {/* ========================================================= */}
        {activeTab === 'jobs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <section className="card-panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">
                    <Cpu size={18} /> Asynchronous Background Jobs Queue
                  </h2>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    Pushed via Redis <code>job_queue</code> list and consumed by Python Worker
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button className="btn-secondary" onClick={fetchJobs} disabled={loadingJobs}>
                    <RefreshCw size={14} className={loadingJobs ? 'spin' : ''} /> Refresh Jobs
                  </button>

                  <button className="btn-primary" onClick={handleTriggerJob} disabled={jobTriggering}>
                    <Cpu size={16} /> {jobTriggering ? 'Queuing Job...' : 'Trigger New Async Job'}
                  </button>
                </div>
              </div>

              {/* Jobs Table */}
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Job ID</th>
                    <th>Job Type</th>
                    <th>Status</th>
                    <th>Result Payload / Summary</th>
                    <th>Created At</th>
                    <th>Completed At</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                        No background jobs triggered yet. Click "Trigger New Async Job" above.
                      </td>
                    </tr>
                  ) : (
                    jobs.map((j) => (
                      <tr key={j.id}>
                        <td><code style={{ fontSize: '0.78rem' }}>{j.id.slice(0, 8)}...</code></td>
                        <td><strong>{j.type}</strong></td>
                        <td>
                          <span className={`status-tag ${j.status.toLowerCase()}`}>
                            {j.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontSize: '0.8rem', color: j.result ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                            {j.result || 'Processing workload in Python worker...'}
                          </div>
                        </td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          {new Date(j.created_at).toLocaleTimeString()}
                        </td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          {j.completed_at ? new Date(j.completed_at).toLocaleTimeString() : '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
