import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import type { UserRole } from '@/lib/types';

export function startDashboardTour(role: UserRole) {
  const isAdmin = role === 'admin';
  const isManager = role === 'manager' || role === 'assistant_manager';
  const isTeamLead = role === 'team_lead';
  const isAgent = role === 'agent';

  const steps = [];

  // Common steps
  steps.push({
    element: '#tour-global-metrics',
    popover: {
      title: 'Global Metrics',
      description: 'These cards give you a quick snapshot of your active leads, closed clients, and support requests.',
      side: 'bottom',
      align: 'start',
    },
  });

  steps.push({
    element: '#tour-active-leads',
    popover: {
      title: 'Active Leads',
      description: 'Shows the number of open leads currently assigned to you or your branch.',
      side: 'bottom',
    },
  });

  if (isAdmin || isManager) {
    steps.push({
      element: '#tour-leadership-dashboard',
      popover: {
        title: 'Leadership Dashboard',
        description: 'Get an overview of branch performance, team statistics, and closing ratios across your scope.',
        side: 'top',
        align: 'start',
      },
    });
  }

  if (isTeamLead || isAgent) {
    steps.push({
      element: '#tour-role-work-dashboard',
      popover: {
        title: 'Your Work Dashboard',
        description: 'Track your daily performance, target achievements, and active assignments here.',
        side: 'top',
        align: 'start',
      },
    });
  }

  let followUpDescription = 'Never miss a follow-up. Leads needing attention are automatically queued here based on their schedules.';
  if (isManager) {
    followUpDescription = 'Track all follow-ups across your branch. Follow-ups for your agents and team leads will automatically be shown here.';
  } else if (isTeamLead) {
    followUpDescription = 'Track your follow-ups and those of your assigned agents here.';
  } else if (isAgent) {
    followUpDescription = 'Your assigned follow-ups will be queued here so you never miss a task.';
  }

  steps.push({
    element: '#tour-follow-up-queue',
    popover: {
      title: 'Follow-Up Queue',
      description: followUpDescription,
      side: 'top',
      align: 'start',
    },
  });

  if (isAdmin) {
    steps.push({
      element: '#tour-financial-insights',
      popover: {
        title: 'Financial Insights',
        description: 'High-level financial charts comparing total deal values vs. net revenue.',
        side: 'top',
        align: 'start',
      },
    });
  }

  steps.push({
    element: '#tour-user-info',
    popover: {
      title: 'Your Information',
      description: 'Quickly verify your account role and reporting hierarchy.',
      side: 'top',
    },
  });

  const driverObj = driver({
    showProgress: true,
    animate: true,
    overlayColor: 'rgba(15, 15, 14, 0.8)',
    steps: steps as any,
  });

  driverObj.drive();
}

export function startLeadsTour(role: UserRole) {
  const steps = [
    {
      element: '#tour-leads-filters',
      popover: {
        title: 'Filter Leads',
        description: 'Use these filters to search by name, filter by status, or narrow down by date and assigned agent.',
        side: 'bottom',
      },
    },
    {
      element: '#tour-leads-actions',
      popover: {
        title: 'Lead Actions',
        description: 'From here you can create new leads manually or export your current filtered list to CSV.',
        side: 'left',
      },
    },
    {
      element: '#tour-lead-view-btn',
      popover: {
        title: 'View Lead Details',
        description: 'Click "View" to open the detailed profile of a lead. This is where you can edit their information, add notes, and schedule follow-ups.',
        side: 'left',
      },
    },
  ];

  driver({
    showProgress: true,
    animate: true,
    overlayColor: 'rgba(15, 15, 14, 0.8)',
    steps: steps as any,
  }).drive();
}

export function startClientsTour(role: UserRole) {
  const steps = [
    {
      element: '#tour-clients-filters',
      popover: {
        title: 'Filter Clients',
        description: 'Quickly find closed clients by searching or filtering by the date they were closed.',
        side: 'bottom',
      },
    },
    {
      element: '#tour-client-view-btn',
      popover: {
        title: 'View Client Profile',
        description: 'Click "View" to see the full details of a closed client, including their deal value and historical notes.',
        side: 'left',
      },
    },
  ];

  driver({
    showProgress: true,
    animate: true,
    overlayColor: 'rgba(15, 15, 14, 0.8)',
    steps: steps as any,
  }).drive();
}

export function startWorkQueueTour(role: UserRole) {
  const steps = [
    {
      element: '#tour-work-queue-tabs',
      popover: {
        title: 'Work Queues',
        description: 'Switch between your New Leads, Follow-ups, and Callbacks to stay on top of your daily tasks.',
        side: 'bottom',
      },
    },
    {
      element: '#tour-work-queue-actions',
      popover: {
        title: 'Action Leads',
        description: 'Update statuses and log calls directly from the queue to keep your pipeline moving.',
        side: 'left',
      },
    },
  ];

  driver({
    showProgress: true,
    animate: true,
    overlayColor: 'rgba(15, 15, 14, 0.8)',
    steps: steps as any,
  }).drive();
}

export function startGenericTour() {
  const steps = [
    {
      popover: {
        title: 'Navigation Guide',
        description: 'Use the sidebar on the left to navigate between different sections of the CRM. Click on any page to see specific tools and data.',
      },
    },
  ];

  driver({
    showProgress: false,
    animate: true,
    overlayColor: 'rgba(15, 15, 14, 0.8)',
    steps: steps as any,
  }).drive();
}

export function startLeadDetailTour(role: UserRole) {
  const steps: any[] = [
    {
      element: '#tour-lead-header',
      popover: {
        title: 'Lead Details',
        description: 'Here you can see the name and current status of the lead.',
        side: 'bottom',
      },
    },
    {
      element: '#tour-lead-actions',
      popover: {
        title: 'Action Buttons',
        description: "Use these buttons to edit the lead's information or close the lead if the sales cycle is complete.",
        side: 'left',
      },
    },
    {
      element: '#tour-lead-info',
      popover: {
        title: 'Lead Information',
        description: 'View the core details about this lead. If you enter Edit mode, you can modify these fields.',
        side: 'top',
      },
    },
  ];

  if (role === 'manager' || role === 'admin') {
    steps.push({
      element: '#tour-lead-assignment',
      popover: {
        title: 'Agent Assignment',
        description: 'As a manager, you can reassign this lead to a different agent from this dropdown.',
        side: 'top',
      },
    });
  }

  steps.push(
    {
      element: '#tour-lead-followup',
      popover: {
        title: 'Follow-ups',
        description: 'Schedule future touchpoints and view any pending follow-ups for this lead.',
        side: 'top',
      },
    },
    {
      element: '#tour-lead-notes',
      popover: {
        title: 'Internal Notes',
        description: 'Leave internal notes about your interactions. This helps the whole team stay aligned.',
        side: 'top',
      },
    },
    {
      element: '#tour-lead-timeline',
      popover: {
        title: 'Activity Timeline',
        description: 'A complete historical log of all actions taken on this lead, including status changes and assignments.',
        side: 'top',
      },
    }
  );

  driver({
    showProgress: true,
    animate: true,
    overlayColor: 'rgba(15, 15, 14, 0.8)',
    steps: steps,
  }).drive();
}
