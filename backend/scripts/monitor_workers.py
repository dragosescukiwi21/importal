#!/usr/bin/env python
"""
Worker Health Monitoring Script for ImportCSV

This script monitors the health of Redis Queue workers, tracks queue depth,
and collects performance metrics for the import processing system.
"""

import os
import sys
import time
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import argparse

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import redis
from rq import Queue, Worker
from rq.job import Job, JobStatus
from rq.registry import (
    StartedJobRegistry,
    FinishedJobRegistry,
    FailedJobRegistry,
    DeferredJobRegistry,
    ScheduledJobRegistry
)

from app.core.config import settings
from app.core.elasticache_config import get_elasticache_connection

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Try to import optional monitoring libraries
try:
    import prometheus_client
    from prometheus_client import Counter, Gauge, Histogram, start_http_server
    PROMETHEUS_AVAILABLE = True
except ImportError:
    PROMETHEUS_AVAILABLE = False
    logger.warning("prometheus_client not installed. Prometheus metrics will not be available.")

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    logger.warning("psutil not installed. System metrics will not be available.")


class WorkerMonitor:
    """Monitor for Redis Queue workers and job processing"""
    
    def __init__(self, redis_conn: redis.Redis, queue_names: List[str] = None):
        """
        Initialize the worker monitor
        
        Args:
            redis_conn: Redis connection
            queue_names: List of queue names to monitor (default: ['imports', 'default'])
        """
        self.redis_conn = redis_conn
        self.queue_names = queue_names or [settings.RQ_IMPORT_QUEUE, 'default']
        self.queues = {name: Queue(name, connection=redis_conn) for name in self.queue_names}
        
        # Initialize Prometheus metrics if available
        if PROMETHEUS_AVAILABLE:
            self._init_prometheus_metrics()
    
    def _init_prometheus_metrics(self):
        """Initialize Prometheus metrics collectors"""
        # Queue metrics
        self.queue_size_gauge = Gauge(
            'rq_queue_size', 
            'Number of jobs in queue', 
            ['queue_name']
        )
        self.queue_started_gauge = Gauge(
            'rq_queue_started_jobs', 
            'Number of started jobs', 
            ['queue_name']
        )
        self.queue_failed_gauge = Gauge(
            'rq_queue_failed_jobs', 
            'Number of failed jobs', 
            ['queue_name']
        )
        self.queue_finished_gauge = Gauge(
            'rq_queue_finished_jobs', 
            'Number of finished jobs', 
            ['queue_name']
        )
        
        # Worker metrics
        self.worker_count_gauge = Gauge(
            'rq_worker_count', 
            'Number of active workers'
        )
        self.worker_busy_gauge = Gauge(
            'rq_worker_busy_count', 
            'Number of busy workers'
        )
        self.worker_idle_gauge = Gauge(
            'rq_worker_idle_count', 
            'Number of idle workers'
        )
        
        # Job processing metrics
        self.job_processing_time_histogram = Histogram(
            'rq_job_processing_seconds',
            'Job processing time in seconds',
            ['queue_name', 'job_type'],
            buckets=(1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600)
        )
        
        # System metrics
        if PSUTIL_AVAILABLE:
            self.system_cpu_gauge = Gauge(
                'system_cpu_percent',
                'System CPU usage percentage'
            )
            self.system_memory_gauge = Gauge(
                'system_memory_percent',
                'System memory usage percentage'
            )
            self.redis_memory_gauge = Gauge(
                'redis_memory_bytes',
                'Redis memory usage in bytes'
            )
    
    def get_queue_stats(self, queue_name: str) -> Dict[str, Any]:
        """
        Get statistics for a specific queue
        
        Args:
            queue_name: Name of the queue
            
        Returns:
            Dictionary with queue statistics
        """
        queue = self.queues.get(queue_name)
        if not queue:
            return {}
        
        # Get registries for different job states
        started_registry = StartedJobRegistry(queue_name, connection=self.redis_conn)
        finished_registry = FinishedJobRegistry(queue_name, connection=self.redis_conn)
        failed_registry = FailedJobRegistry(queue_name, connection=self.redis_conn)
        deferred_registry = DeferredJobRegistry(queue_name, connection=self.redis_conn)
        scheduled_registry = ScheduledJobRegistry(queue_name, connection=self.redis_conn)
        
        stats = {
            'name': queue_name,
            'queued': len(queue),
            'started': len(started_registry),
            'finished': len(finished_registry),
            'failed': len(failed_registry),
            'deferred': len(deferred_registry),
            'scheduled': len(scheduled_registry),
            'total_jobs': len(queue) + len(started_registry),
        }
        
        # Get recent job statistics
        recent_jobs = self._get_recent_job_stats(queue_name)
        stats.update(recent_jobs)
        
        # Update Prometheus metrics if available
        if PROMETHEUS_AVAILABLE:
            self.queue_size_gauge.labels(queue_name=queue_name).set(stats['queued'])
            self.queue_started_gauge.labels(queue_name=queue_name).set(stats['started'])
            self.queue_failed_gauge.labels(queue_name=queue_name).set(stats['failed'])
            self.queue_finished_gauge.labels(queue_name=queue_name).set(stats['finished'])
        
        return stats
    
    def _get_recent_job_stats(self, queue_name: str, hours: int = 1) -> Dict[str, Any]:
        """
        Get statistics for recent jobs
        
        Args:
            queue_name: Name of the queue
            hours: Number of hours to look back
            
        Returns:
            Dictionary with recent job statistics
        """
        cutoff_time = datetime.now() - timedelta(hours=hours)
        
        finished_registry = FinishedJobRegistry(queue_name, connection=self.redis_conn)
        failed_registry = FailedJobRegistry(queue_name, connection=self.redis_conn)
        
        recent_finished = 0
        recent_failed = 0
        total_processing_time = 0
        processing_times = []
        
        # Check finished jobs
        for job_id in finished_registry.get_job_ids():
            try:
                job = Job.fetch(job_id, connection=self.redis_conn)
                if job.ended_at and job.ended_at.replace(tzinfo=None) > cutoff_time:
                    recent_finished += 1
                    if job.started_at and job.ended_at:
                        processing_time = (job.ended_at - job.started_at).total_seconds()
                        processing_times.append(processing_time)
                        total_processing_time += processing_time
            except Exception:
                continue
        
        # Check failed jobs
        for job_id in failed_registry.get_job_ids():
            try:
                job = Job.fetch(job_id, connection=self.redis_conn)
                if job.ended_at and job.ended_at.replace(tzinfo=None) > cutoff_time:
                    recent_failed += 1
            except Exception:
                continue
        
        stats = {
            f'recent_finished_{hours}h': recent_finished,
            f'recent_failed_{hours}h': recent_failed,
        }
        
        if processing_times:
            stats['avg_processing_time'] = sum(processing_times) / len(processing_times)
            stats['max_processing_time'] = max(processing_times)
            stats['min_processing_time'] = min(processing_times)
        
        return stats
    
    def get_worker_stats(self) -> Dict[str, Any]:
        """
        Get statistics for all workers
        
        Returns:
            Dictionary with worker statistics
        """
        all_workers = Worker.all(connection=self.redis_conn)
        
        active_workers = []
        busy_workers = []
        idle_workers = []
        
        for worker in all_workers:
            worker_info = {
                'name': worker.name,
                'queues': [q.name for q in worker.queues],
                'state': worker.get_state(),
                'current_job': None,
                'successful_job_count': worker.successful_job_count,
                'failed_job_count': worker.failed_job_count,
                'total_working_time': worker.total_working_time,
                'birth_date': worker.birth_date.isoformat() if worker.birth_date else None,
                'last_heartbeat': worker.last_heartbeat.isoformat() if worker.last_heartbeat else None,
            }
            
            # Check if worker is busy
            current_job = worker.get_current_job()
            if current_job:
                worker_info['current_job'] = {
                    'id': current_job.id,
                    'func_name': current_job.func_name,
                    'started_at': current_job.started_at.isoformat() if current_job.started_at else None,
                    'timeout': current_job.timeout,
                }
                busy_workers.append(worker_info)
            else:
                idle_workers.append(worker_info)
            
            active_workers.append(worker_info)
        
        stats = {
            'total_workers': len(all_workers),
            'busy_workers': len(busy_workers),
            'idle_workers': len(idle_workers),
            'workers': active_workers,
        }
        
        # Update Prometheus metrics if available
        if PROMETHEUS_AVAILABLE:
            self.worker_count_gauge.set(len(all_workers))
            self.worker_busy_gauge.set(len(busy_workers))
            self.worker_idle_gauge.set(len(idle_workers))
        
        return stats
    
    def get_system_stats(self) -> Dict[str, Any]:
        """
        Get system-level statistics
        
        Returns:
            Dictionary with system statistics
        """
        stats = {}
        
        # Redis stats
        try:
            redis_info = self.redis_conn.info()
            stats['redis'] = {
                'version': redis_info.get('redis_version'),
                'uptime_seconds': redis_info.get('uptime_in_seconds'),
                'connected_clients': redis_info.get('connected_clients'),
                'used_memory': redis_info.get('used_memory'),
                'used_memory_human': redis_info.get('used_memory_human'),
                'used_memory_peak': redis_info.get('used_memory_peak'),
                'used_memory_peak_human': redis_info.get('used_memory_peak_human'),
                'total_commands_processed': redis_info.get('total_commands_processed'),
                'instantaneous_ops_per_sec': redis_info.get('instantaneous_ops_per_sec'),
            }
            
            if PROMETHEUS_AVAILABLE:
                self.redis_memory_gauge.set(redis_info.get('used_memory', 0))
        except Exception as e:
            logger.error(f"Failed to get Redis stats: {e}")
            stats['redis'] = {'error': str(e)}
        
        # System stats (if psutil is available)
        if PSUTIL_AVAILABLE:
            try:
                stats['system'] = {
                    'cpu_percent': psutil.cpu_percent(interval=1),
                    'memory_percent': psutil.virtual_memory().percent,
                    'disk_usage': psutil.disk_usage('/').percent,
                    'load_average': os.getloadavg() if hasattr(os, 'getloadavg') else None,
                }
                
                if PROMETHEUS_AVAILABLE:
                    self.system_cpu_gauge.set(stats['system']['cpu_percent'])
                    self.system_memory_gauge.set(stats['system']['memory_percent'])
            except Exception as e:
                logger.error(f"Failed to get system stats: {e}")
                stats['system'] = {'error': str(e)}
        
        return stats
    
    def check_worker_health(self, max_heartbeat_age: int = 60) -> Dict[str, Any]:
        """
        Check the health of all workers
        
        Args:
            max_heartbeat_age: Maximum age in seconds for a heartbeat to be considered healthy
            
        Returns:
            Dictionary with health check results
        """
        all_workers = Worker.all(connection=self.redis_conn)
        now = datetime.now()
        
        healthy_workers = []
        unhealthy_workers = []
        dead_workers = []
        
        for worker in all_workers:
            if not worker.last_heartbeat:
                dead_workers.append(worker.name)
                continue
            
            heartbeat_age = (now - worker.last_heartbeat.replace(tzinfo=None)).total_seconds()
            
            if heartbeat_age > max_heartbeat_age * 2:
                dead_workers.append({
                    'name': worker.name,
                    'last_heartbeat': worker.last_heartbeat.isoformat(),
                    'age_seconds': heartbeat_age,
                })
            elif heartbeat_age > max_heartbeat_age:
                unhealthy_workers.append({
                    'name': worker.name,
                    'last_heartbeat': worker.last_heartbeat.isoformat(),
                    'age_seconds': heartbeat_age,
                })
            else:
                healthy_workers.append({
                    'name': worker.name,
                    'last_heartbeat': worker.last_heartbeat.isoformat(),
                    'age_seconds': heartbeat_age,
                })
        
        return {
            'healthy': len(healthy_workers),
            'unhealthy': len(unhealthy_workers),
            'dead': len(dead_workers),
            'healthy_workers': healthy_workers,
            'unhealthy_workers': unhealthy_workers,
            'dead_workers': dead_workers,
        }
    
    def get_all_stats(self) -> Dict[str, Any]:
        """
        Get all monitoring statistics
        
        Returns:
            Dictionary with all statistics
        """
        stats = {
            'timestamp': datetime.now().isoformat(),
            'queues': {},
            'workers': self.get_worker_stats(),
            'health': self.check_worker_health(),
            'system': self.get_system_stats(),
        }
        
        # Get stats for each queue
        for queue_name in self.queue_names:
            stats['queues'][queue_name] = self.get_queue_stats(queue_name)
        
        return stats
    
    def run_continuous_monitoring(self, interval: int = 30, prometheus_port: int = 9090):
        """
        Run continuous monitoring with periodic updates
        
        Args:
            interval: Update interval in seconds
            prometheus_port: Port for Prometheus metrics server
        """
        # Start Prometheus HTTP server if available
        if PROMETHEUS_AVAILABLE and prometheus_port:
            start_http_server(prometheus_port)
            logger.info(f"Prometheus metrics server started on port {prometheus_port}")
        
        logger.info(f"Starting continuous monitoring with {interval}s interval")
        
        while True:
            try:
                stats = self.get_all_stats()
                
                # Log summary
                total_queued = sum(q['queued'] for q in stats['queues'].values())
                total_processing = sum(q['started'] for q in stats['queues'].values())
                
                logger.info(
                    f"Monitor Update - "
                    f"Queued: {total_queued}, "
                    f"Processing: {total_processing}, "
                    f"Workers: {stats['workers']['total_workers']} "
                    f"(Busy: {stats['workers']['busy_workers']}, "
                    f"Idle: {stats['workers']['idle_workers']}), "
                    f"Health: {stats['health']['healthy']}/{stats['workers']['total_workers']} healthy"
                )
                
                # Check for alerts
                self._check_alerts(stats)
                
                # Optionally write stats to file
                if os.getenv('MONITOR_OUTPUT_FILE'):
                    with open(os.getenv('MONITOR_OUTPUT_FILE'), 'w') as f:
                        json.dump(stats, f, indent=2, default=str)
                
            except Exception as e:
                logger.error(f"Error during monitoring: {e}")
            
            time.sleep(interval)
    
    def _check_alerts(self, stats: Dict[str, Any]):
        """
        Check for conditions that should trigger alerts
        
        Args:
            stats: Current statistics
        """
        # Alert if no workers are running
        if stats['workers']['total_workers'] == 0:
            logger.warning("ALERT: No workers are running!")
        
        # Alert if too many jobs are queued
        for queue_name, queue_stats in stats['queues'].items():
            if queue_stats['queued'] > 100:
                logger.warning(f"ALERT: High queue depth in {queue_name}: {queue_stats['queued']} jobs")
            
            if queue_stats['failed'] > 10:
                logger.warning(f"ALERT: High failure rate in {queue_name}: {queue_stats['failed']} failed jobs")
        
        # Alert if workers are unhealthy
        if stats['health']['unhealthy'] > 0:
            logger.warning(f"ALERT: {stats['health']['unhealthy']} unhealthy workers detected")
        
        if stats['health']['dead'] > 0:
            logger.warning(f"ALERT: {stats['health']['dead']} dead workers detected")
        
        # Alert on system resources
        if stats.get('system', {}).get('cpu_percent', 0) > 90:
            logger.warning(f"ALERT: High CPU usage: {stats['system']['cpu_percent']}%")
        
        if stats.get('system', {}).get('memory_percent', 0) > 90:
            logger.warning(f"ALERT: High memory usage: {stats['system']['memory_percent']}%")


def main():
    """Main function for the monitoring script"""
    parser = argparse.ArgumentParser(description='Monitor ImportCSV Redis Queue workers')
    parser.add_argument(
        '--mode',
        choices=['once', 'continuous'],
        default='continuous',
        help='Monitoring mode: once for single check, continuous for ongoing monitoring'
    )
    parser.add_argument(
        '--interval',
        type=int,
        default=30,
        help='Update interval in seconds for continuous monitoring'
    )
    parser.add_argument(
        '--prometheus-port',
        type=int,
        default=9090,
        help='Port for Prometheus metrics server (0 to disable)'
    )
    parser.add_argument(
        '--queues',
        nargs='+',
        help='Queue names to monitor (default: imports, default)'
    )
    parser.add_argument(
        '--output',
        choices=['console', 'json'],
        default='console',
        help='Output format'
    )
    
    args = parser.parse_args()
    
    # Get Redis connection
    try:
        redis_conn = get_elasticache_connection()
        logger.info("Connected to Redis successfully")
    except Exception as e:
        logger.error(f"Failed to connect to Redis: {e}")
        sys.exit(1)
    
    # Create monitor
    monitor = WorkerMonitor(redis_conn, queue_names=args.queues)
    
    if args.mode == 'once':
        # Single check
        stats = monitor.get_all_stats()
        
        if args.output == 'json':
            print(json.dumps(stats, indent=2, default=str))
        else:
            # Console output
            print("\n" + "="*60)
            print("IMPORTCSV WORKER MONITOR")
            print("="*60)
            print(f"Timestamp: {stats['timestamp']}")
            
            print("\nQUEUE STATUS:")
            for queue_name, queue_stats in stats['queues'].items():
                print(f"  {queue_name}:")
                print(f"    Queued: {queue_stats['queued']}")
                print(f"    Processing: {queue_stats['started']}")
                print(f"    Finished: {queue_stats['finished']}")
                print(f"    Failed: {queue_stats['failed']}")
                if 'avg_processing_time' in queue_stats:
                    print(f"    Avg Processing Time: {queue_stats['avg_processing_time']:.2f}s")
            
            print(f"\nWORKER STATUS:")
            print(f"  Total Workers: {stats['workers']['total_workers']}")
            print(f"  Busy: {stats['workers']['busy_workers']}")
            print(f"  Idle: {stats['workers']['idle_workers']}")
            
            print(f"\nHEALTH CHECK:")
            print(f"  Healthy: {stats['health']['healthy']}")
            print(f"  Unhealthy: {stats['health']['unhealthy']}")
            print(f"  Dead: {stats['health']['dead']}")
            
            if 'redis' in stats['system']:
                print(f"\nREDIS STATUS:")
                print(f"  Memory: {stats['system']['redis'].get('used_memory_human', 'N/A')}")
                print(f"  Clients: {stats['system']['redis'].get('connected_clients', 'N/A')}")
                print(f"  Ops/sec: {stats['system']['redis'].get('instantaneous_ops_per_sec', 'N/A')}")
            
            if 'system' in stats['system']:
                print(f"\nSYSTEM STATUS:")
                print(f"  CPU: {stats['system']['system'].get('cpu_percent', 'N/A')}%")
                print(f"  Memory: {stats['system']['system'].get('memory_percent', 'N/A')}%")
            
            print("="*60 + "\n")
    else:
        # Continuous monitoring
        monitor.run_continuous_monitoring(
            interval=args.interval,
            prometheus_port=args.prometheus_port
        )


if __name__ == '__main__':
    main()
