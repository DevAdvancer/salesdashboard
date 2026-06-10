"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createLeadAction,
  reopenLeadAction,
  updateLeadAction,
} from "@/app/actions/lead";
import {
  assignLeadAction,
  backoutLeadAction,
  closeLeadAction,
  notInterestedLeadAction,
} from "@/lib/actions/lead-actions";
import { clearLeadReadCache } from "@/lib/services/lead-action-service";
import { queryKeys } from "@/lib/queries/keys";
import type { CreateLeadInput, LeadData, UserRole } from "@/lib/types";

/**
 * Build a predicate that matches every cached lead list for a given
 * scope (userId:role). Used by mutations to invalidate only the
 * current user's caches — never another user's data.
 */
function leadsListPredicate(scope: string) {
  return (query: { queryKey: readonly unknown[] }) => {
    const [root, kind, candidateScope] = query.queryKey;
    if (root !== "leads" || kind !== "list") return false;
    return candidateScope === scope;
  };
}

function countsPredicate(scope: string) {
  return (query: { queryKey: readonly unknown[] }) => {
    const [root, kind, candidateScope] = query.queryKey;
    if (root !== "leads" || kind !== "counts") return false;
    return candidateScope === scope;
  };
}

export function useCreateLeadMutation(scope: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLeadInput) => createLeadAction(scope, input),
    onSuccess: () => {
      clearLeadReadCache();
      qc.invalidateQueries({ queryKey: queryKeys.leads.all, predicate: (q) =>
        leadsListPredicate(scope)(q) || countsPredicate(scope)(q)
      });
    },
  });
}

export function useUpdateLeadMutation(scope: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      leadId: string;
      data: Partial<LeadData>;
      actorId: string;
      actorName?: string;
    }) =>
      updateLeadAction(input.leadId, input.data, input.actorId, input.actorName),
    onSuccess: (lead) => {
      clearLeadReadCache();
      qc.invalidateQueries({ queryKey: queryKeys.leads.all, predicate: (q) =>
        leadsListPredicate(scope)(q) || countsPredicate(scope)(q)
      });
      qc.invalidateQueries({ queryKey: queryKeys.leads.detail(lead.$id) });
    },
  });
}

export function useReopenLeadMutation(scope: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { leadId: string; actorId?: string; actorName?: string }) =>
      reopenLeadAction(input.leadId, input.actorId, input.actorName),
    onSuccess: (lead) => {
      clearLeadReadCache();
      qc.invalidateQueries({ queryKey: queryKeys.leads.all, predicate: (q) =>
        leadsListPredicate(scope)(q) || countsPredicate(scope)(q)
      });
      qc.invalidateQueries({ queryKey: queryKeys.leads.detail(lead.$id) });
    },
  });
}

export function useCloseLeadMutation(scope: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      leadId: string;
      closedStatus: string;
      actorId: string;
      actorName: string;
      actorRole?: UserRole;
    }) =>
      closeLeadAction(
        input.leadId,
        input.closedStatus,
        input.actorId,
        input.actorName,
        input.actorRole
      ),
    onSuccess: (res) => {
      clearLeadReadCache();
      qc.invalidateQueries({ queryKey: queryKeys.leads.all, predicate: (q) =>
        leadsListPredicate(scope)(q) || countsPredicate(scope)(q)
      });
      qc.invalidateQueries({ queryKey: queryKeys.leads.detail(res.lead.$id) });
    },
  });
}

export function useAssignLeadMutation(scope: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      leadId: string;
      agentId: string;
      actorId: string;
      actorName: string;
    }) =>
      assignLeadAction(input.leadId, input.agentId, input.actorId, input.actorName),
    onSuccess: (res) => {
      clearLeadReadCache();
      qc.invalidateQueries({ queryKey: queryKeys.leads.all, predicate: (q) =>
        leadsListPredicate(scope)(q) || countsPredicate(scope)(q)
      });
      qc.invalidateQueries({ queryKey: queryKeys.leads.detail(res.lead.$id) });
    },
  });
}

export function useBackoutLeadMutation(scope: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      leadId: string;
      actorId: string;
      actorName: string;
    }) => backoutLeadAction(input.leadId, input.actorId, input.actorName),
    onSuccess: (res) => {
      clearLeadReadCache();
      qc.invalidateQueries({ queryKey: queryKeys.leads.all, predicate: (q) =>
        leadsListPredicate(scope)(q) || countsPredicate(scope)(q)
      });
      qc.invalidateQueries({ queryKey: queryKeys.leads.detail(res.lead.$id) });
    },
  });
}

export function useNotInterestedLeadMutation(scope: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { leadId: string; actorId: string; actorName: string }) =>
      notInterestedLeadAction(input.leadId, input.actorId, input.actorName),
    onSuccess: (res) => {
      clearLeadReadCache();
      qc.invalidateQueries({ queryKey: queryKeys.leads.all, predicate: (q) =>
        leadsListPredicate(scope)(q) || countsPredicate(scope)(q)
      });
      qc.invalidateQueries({ queryKey: queryKeys.leads.detail(res.lead.$id) });
    },
  });
}
