import { useState, useRef, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { BrainDumpItem, ItemType, BudgetConfig, Skill, Wallet, FinanceType, AppSettings, SyncStatus, DbSchema, ShoppingCategory } from '../types';
import { classifyText, DEFAULT_PROMPT } from '../services/geminiService';
import { calculateNextDueDate, calculateFirstDueDate } from '../utils/selectors';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../src/firebase'; 

export const useBrainDumpData = (userId: string | undefined) => {
    const [items, setItems] = useState<BrainDumpItem[]>([]);
    const [budgetConfig, setBudgetConfig] = useState<BudgetConfig>({
        monthlyIncome: 0,
        rules: [
            { id: 'needs', name: 'Needs', percentage: 50, color: 'bg-blue-500' },
            { id: 'wants', name: 'Wants', percentage: 30, color: 'bg-pink-500' },
            { id: 'savings', name: 'Savings', percentage: 20, color: 'bg-emerald-500' },
        ]
    });
    const [skills, setSkills] = useState<Skill[]>([]);
    const [wallets, setWallets] = useState<Wallet[]>([]);
    const [customPrompt, setCustomPrompt] = useState<string>(DEFAULT_PROMPT);
    const [monthlyThemes, setMonthlyThemes] = useState<Record<string, string>>({});
    const [appSettings, setAppSettings] = useState<AppSettings>({ defaultCollapsed: false, hideMoney: false });

    const [loading, setLoading] = useState(true);
    const [pendingCount, setPendingCount] = useState(0); 
    const [error, setError] = useState<string | null>(null);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');

    const itemsRef = useRef(items);
    itemsRef.current = items;

    // Helper: Routine Resets
    const checkRoutineResets = (currentItems: BrainDumpItem[]) => {
        const now = new Date();
        const newHistoryItems: BrainDumpItem[] = [];

        const updatedItems = currentItems.map(item => {
            const isShoppingRoutine = item.type === ItemType.SHOPPING && item.meta.shoppingCategory === 'routine';
            const isTodoRoutine = item.type === ItemType.TODO && item.meta.isRoutine;

            if ((isShoppingRoutine || isTodoRoutine) && item.status === 'done' && item.completed_at) {
                
                const completedDate = new Date(item.completed_at);
                let nextDueTime = completedDate.getTime();
                
                if (isShoppingRoutine) {
                    // Shopping routines use the same logic now if they have these fields, 
                    // otherwise fallback to recurrenceDays
                    if (item.meta.routineInterval) {
                        nextDueTime = calculateNextDueDate(
                            completedDate,
                            item.meta.routineInterval,
                            item.meta.routineDaysOfWeek,
                            item.meta.routineDaysOfMonth,
                            item.meta.routineMonthsOfYear
                        ).getTime();
                    } else {
                        const recurrenceDays = item.meta.recurrenceDays || 7;
                        nextDueTime = completedDate.getTime() + (recurrenceDays * 24 * 60 * 60 * 1000);
                    }
                } else if (isTodoRoutine) {
                    nextDueTime = calculateNextDueDate(
                        completedDate,
                        item.meta.routineInterval || 'daily',
                        item.meta.routineDaysOfWeek,
                        item.meta.routineDaysOfMonth,
                        item.meta.routineMonthsOfYear
                    ).getTime();
                }
                
                if (now.getTime() >= nextDueTime) {
                    // Reset the main item to pending for the new cycle
                    return {
                        ...item,
                        status: 'pending' as const,
                        completed_at: undefined,
                        meta: {
                            ...item.meta,
                            date: new Date(nextDueTime).toISOString() // Set due date to the calculated next due time
                        }
                    };
                }
            }
            return item;
        });

        return updatedItems;
    };

    const saveAndSync = async (
        newItems: BrainDumpItem[], 
        newConfig?: BudgetConfig, 
        newPrompt?: string, 
        newSkills?: Skill[], 
        newWallets?: Wallet[], 
        newThemes?: Record<string, string>, 
        newAppSettings?: AppSettings
    ) => {
        if (!userId) return; // Mencegah save jika tidak ada user

        setSyncStatus('syncing');
        try {
            const dataToSave = {
                data: newItems,
                budgetConfig: newConfig || budgetConfig,
                customPrompt: newPrompt !== undefined ? newPrompt : customPrompt,
                skills: newSkills || skills,
                wallets: newWallets || wallets,
                monthlyThemes: newThemes || monthlyThemes,
                appSettings: newAppSettings || appSettings
            };

            // Simpan ke Firestore
            const userRef = doc(db, 'users', userId);
            await setDoc(userRef, dataToSave, { merge: true });
            
            setSyncStatus('synced');
        } catch (e) {
            console.error("Gagal save ke Firebase:", e);
            setSyncStatus('error');
        }
    };

    const loadData = useCallback(async () => {
        if (!userId) return; // Jangan load jika belum login

        try {
            if (items.length === 0) setLoading(true);
            setError(null);

            // Ambil data dari Firestore
            const userRef = doc(db, 'users', userId);
            const docSnap = await getDoc(userRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                
                // MIGRATION & SET STATE
                if (Array.isArray(data.data)) {
                    const migratedData = data.data.map((item: any) => ({
                        ...item,
                        meta: {
                            tags: [],
                            ...item.meta,
                            shoppingCategory: (item.type === ItemType.SHOPPING && !item.meta?.shoppingCategory) 
                                ? 'not_urgent' 
                                : item.meta?.shoppingCategory
                        }
                    }));

                    const checkedData = checkRoutineResets(migratedData);
                    setItems(checkedData);
                }

                if (data.budgetConfig) setBudgetConfig(data.budgetConfig);
                if (data.customPrompt) setCustomPrompt(data.customPrompt);
                if (data.skills) setSkills(data.skills);
                if (data.wallets) setWallets(data.wallets);
                if (data.monthlyThemes) setMonthlyThemes(data.monthlyThemes);
                if (data.appSettings) setAppSettings(data.appSettings);
                
                setSyncStatus('synced');
            } else {
                // Jika user baru pertama kali login dan belum punya data, buat default wallet
                const defaultWallet: Wallet = { id: 'w-1', name: 'Cash', type: 'cash', initialBalance: 0, color: 'bg-emerald-500' };
                setWallets([defaultWallet]);
                setSyncStatus('synced');
            }
        } catch (err) {
            console.error("Gagal load dari Firebase:", err);
            setError("Failed to load data. Please check connection.");
            setSyncStatus('error');
        } finally {
            setLoading(false);
        }
    }, [userId]); 


    const processItemInBackground = async (text: string, tempId: string) => {
        try {
            const currentTags = new Set<string>();
            itemsRef.current.forEach(i => i.meta?.tags?.forEach(t => currentTags.add(t)));
            
            // Pass known skills to classifier
            const skillNames = skills.map(s => s.name);
    
            const classifiedItems = await classifyText(text, Array.from(currentTags), skillNames, 0, customPrompt);
      
            const newItems: BrainDumpItem[] = classifiedItems.map(partial => {
                const isFinance = partial.type === ItemType.FINANCE;
                // Finance and Skill Logs are records, so mark as done. Journal is also a record.
                const isRecord = isFinance || partial.type === ItemType.SKILL_LOG || partial.type === ItemType.JOURNAL;
                
                // Resolve Skill ID if it's a SKILL_LOG
                let finalMeta = { tags: [], ...partial.meta };
                if (partial.type === ItemType.SKILL_LOG && partial.meta?.skillName) {
                    // Try exact match (case insensitive)
                    const matchedSkill = skills.find(s => s.name.toLowerCase() === partial.meta?.skillName?.toLowerCase());
                    
                    if (matchedSkill) {
                        finalMeta = { ...finalMeta, skillId: matchedSkill.id };
                    } else {
                        if (skills.length > 0) {
                            finalMeta = { ...finalMeta, skillId: skills[0].id }; // Default assignment
                        }
                    }
                }
    
                return {
                    id: uuidv4(),
                    status: isRecord ? 'done' : 'pending',
                    created_at: new Date().toISOString(),
                    completed_at: isRecord ? new Date().toISOString() : undefined,
                    type: ItemType.NOTE,
                    content: text, // Fallback content
                    ...partial, 
                    meta: finalMeta, // Use resolved meta
                    isOptimistic: false,
                };
            });
      
            setItems((prev) => {
                 const prevWithoutOptimistic = prev.filter(i => i.id !== tempId);
                 const updated = [...newItems, ...prevWithoutOptimistic];
                 saveAndSync(updated); 
                 return updated;
            });
    
        } catch (err) {
            console.error("Processing failed", err);
            setItems(prev => {
                const updated = prev.map(i => i.id === tempId ? { ...i, isOptimistic: false } : i);
                saveAndSync(updated);
                return updated;
            });
        } finally {
            setPendingCount(prev => Math.max(0, prev - 1));
        }
    };

    const handleSend = async (text: string) => {
        setPendingCount(prev => prev + 1);
        setError(null);
        const tempId = uuidv4();
    
        const optimisticItem: BrainDumpItem = {
          id: tempId,
          type: ItemType.NOTE,
          content: text,
          status: 'pending',
          created_at: new Date().toISOString(),
          meta: { tags: [] },
          isOptimistic: true,
        };
    
        setItems((prev) => {
            const updated = [optimisticItem, ...prev];
            saveAndSync(updated); // Syncing items only, keeps existing config
            return updated;
        });
    
        processItemInBackground(text, tempId);
    };

    const handleToggleStatus = async (id: string) => {
        const prevItems = itemsRef.current;
        const targetItem = prevItems.find(i => i.id === id);
        if (!targetItem) return;
    
        const newStatus: 'pending' | 'done' = targetItem.status === 'pending' ? 'done' : 'pending';
        const completedAt = newStatus === 'done' ? new Date().toISOString() : undefined;
        
        // Logic: If marking Done, progress becomes 100%. If marking Pending, progress becomes 0%.
        // This syncs the checkbox with the slider logic.
        const newProgress = newStatus === 'done' ? 100 : 0;
        const newProgressNotes = targetItem.meta.progressNotes; // Keep existing notes

        // Update date to today if marking as done for shopping/finance
        let newDate = targetItem.meta.date;
        if (newStatus === 'done' && (targetItem.type === ItemType.SHOPPING || targetItem.type === ItemType.FINANCE)) {
            newDate = new Date().toISOString();
        }

        const isShoppingRoutine = targetItem.type === ItemType.SHOPPING && targetItem.meta.shoppingCategory === 'routine';
        const isTodoRoutine = targetItem.type === ItemType.TODO && targetItem.meta.isRoutine;

        let historyItemIdToCreate: string | undefined;
        let historyItemIdToDelete: string | undefined;

        if (newStatus === 'done' && (isShoppingRoutine || isTodoRoutine)) {
            historyItemIdToCreate = uuidv4();
        } else if (newStatus === 'pending' && (isShoppingRoutine || isTodoRoutine)) {
            historyItemIdToDelete = targetItem.meta.lastGeneratedHistoryId;
        }

        let updatedItems = prevItems.map(item => 
          item.id === id ? { 
              ...item, 
              status: newStatus, 
              completed_at: completedAt,
              meta: { 
                  ...item.meta, 
                  progress: newProgress, 
                  progressNotes: newProgressNotes,
                  date: newDate,
                  lastGeneratedHistoryId: historyItemIdToCreate ? historyItemIdToCreate : (newStatus === 'pending' ? undefined : item.meta.lastGeneratedHistoryId)
              }
          } : item
        );

        // If unchecking, remove the history item that was generated
        if (historyItemIdToDelete) {
            updatedItems = updatedItems.filter(i => i.id !== historyItemIdToDelete);
        }

        // NEW LOGIC: If marking as done and it's a routine, create history item
        if (historyItemIdToCreate) {
            let newType = targetItem.type;
            let newMeta = { ...targetItem.meta, isRoutine: false };

            if (isShoppingRoutine) {
                newType = ItemType.FINANCE;
                newMeta = {
                    ...newMeta,
                    financeType: 'expense',
                    shoppingCategory: undefined,
                    amount: targetItem.meta.amount,
                    budgetCategory: targetItem.meta.budgetCategory,
                    paymentMethod: targetItem.meta.paymentMethod
                };
            } else if (isTodoRoutine) {
                newType = ItemType.JOURNAL;
                newMeta = {
                    ...newMeta,
                    progress: undefined,
                    progressNotes: undefined
                };
            }

            const historyItem: BrainDumpItem = {
                ...targetItem,
                id: historyItemIdToCreate,
                type: newType,
                status: 'done',
                created_at: completedAt || new Date().toISOString(),
                completed_at: completedAt,
                meta: {
                    ...newMeta,
                    date: completedAt || new Date().toISOString()
                }
            };
            
            updatedItems.push(historyItem);
        }

        setItems(updatedItems);
        saveAndSync(updatedItems);
    };
    
    const handleResetRoutine = async (id: string) => {
        const prev = itemsRef.current;
        const item = prev.find(i => i.id === id);
        
        // Check if it's a routine (either explicit isRoutine OR shopping routine category)
        const isShoppingRoutine = item?.type === ItemType.SHOPPING && item?.meta.shoppingCategory === 'routine';
        const isTodoRoutine = item?.type === ItemType.TODO && item?.meta.isRoutine;
        
        if (!item || (!isTodoRoutine && !isShoppingRoutine) || item.status !== 'done') return;

        // Reset the main item to pending
        // We don't advance the date here because the user wants to do it "again" (presumably now or soon)
        // The date will be updated when they complete it again (if logic exists) or stays as is.
        const updatedItem: BrainDumpItem = {
            ...item,
            status: 'pending',
            completed_at: undefined,
            meta: {
                ...item.meta,
                progress: 0,
                progressNotes: undefined,
                lastGeneratedHistoryId: undefined // Clear it so it doesn't get deleted later
            }
        };

        const updatedList = prev.map(i => i.id === id ? updatedItem : i);
        
        setItems(updatedList);
        saveAndSync(updatedList);
    };

    const handleDelete = async (id: string) => {
        const updatedItems = itemsRef.current.filter(i => i.id !== id);
        setItems(updatedItems);
        saveAndSync(updatedItems);
    };
    
    const handleAddRoutineTask = async (
        content: string,
        interval: 'daily' | 'weekly' | 'monthly' | 'yearly', 
        daysOfWeek?: number[],
        daysOfMonth?: number[],
        monthsOfYear?: number[],
        customDate?: string,
        recurrenceDays?: number // Legacy/Fallback
    ) => {
        const now = new Date();
        let initialNextDue = customDate ? new Date(customDate) : calculateFirstDueDate(
            now, 
            interval, 
            daysOfWeek, 
            daysOfMonth, 
            monthsOfYear
        );
        
        const newItem: BrainDumpItem = {
            id: uuidv4(),
            type: ItemType.TODO,
            content,
            status: 'pending',
            created_at: new Date().toISOString(),
            meta: {
                tags: ['routine'],
                isRoutine: true,
                routineInterval: interval,
                routineDaysOfWeek: daysOfWeek,
                routineDaysOfMonth: daysOfMonth,
                routineMonthsOfYear: monthsOfYear,
                recurrenceDays: recurrenceDays || 1, // Keep for backward compatibility
                date: initialNextDue.toISOString()
            }
        };

        const updated = [newItem, ...itemsRef.current];
        setItems(updated);
        saveAndSync(updated);
    };

    const handleUpdateItem = async (
        id: string, 
        newContent: string, 
        newTags: string[], 
        newAmount?: number, 
        newDate?: string, 
        newPaymentMethod?: string, 
        newBudgetCategory?: string, 
        newDuration?: number, 
        newSkillId?: string, 
        newToWallet?: string, 
        newFinanceType?: FinanceType,
        newProgress?: number,
        newProgressNotes?: string,
        newShoppingCategory?: ShoppingCategory,
        newRecurrenceDays?: number,
        newQuantity?: string,
        newIsRoutine?: boolean,
        newRoutineInterval?: 'daily' | 'weekly' | 'monthly' | 'yearly',
        newRoutineDaysOfWeek?: number[],
        newRoutineDaysOfMonth?: number[],
        newRoutineMonthsOfYear?: number[],
        newSavingGoalId?: string,
        newDedicatedWalletId?: string
    ) => {
          const updatedItems = itemsRef.current.map(item => {
              if (item.id !== id) return item;

              // Auto-update status based on progress
              let newStatus = item.status;
              let completedAt = item.completed_at;

              if (newProgress !== undefined) {
                  if (newProgress === 100 && item.status === 'pending') {
                      newStatus = 'done';
                      completedAt = new Date().toISOString();
                  } else if (newProgress < 100 && item.status === 'done') {
                      newStatus = 'pending';
                      completedAt = undefined;
                  }
              }

              let finalDate = newDate || item.meta.date;

              // Recalculate Date if Routine Config Changed AND Date wasn't manually set
              if (!newDate && (newIsRoutine || item.meta.isRoutine)) {
                  // If routine params changed
                  const interval = newRoutineInterval || item.meta.routineInterval || 'daily';
                  const daysOfWeek = newRoutineDaysOfWeek || item.meta.routineDaysOfWeek;
                  const daysOfMonth = newRoutineDaysOfMonth || item.meta.routineDaysOfMonth;
                  const monthsOfYear = newRoutineMonthsOfYear || item.meta.routineMonthsOfYear;
                  
                  // Only recalculate if we are pending. If done, the next reset will handle it.
                  if (item.status === 'pending') {
                      // Check if any schedule param actually changed
                      const scheduleChanged = 
                          interval !== item.meta.routineInterval ||
                          JSON.stringify(daysOfWeek) !== JSON.stringify(item.meta.routineDaysOfWeek) ||
                          JSON.stringify(daysOfMonth) !== JSON.stringify(item.meta.routineDaysOfMonth) ||
                          JSON.stringify(monthsOfYear) !== JSON.stringify(item.meta.routineMonthsOfYear);
                      
                      if (scheduleChanged) {
                          const nextDue = calculateFirstDueDate(new Date(), interval, daysOfWeek, daysOfMonth, monthsOfYear);
                          finalDate = nextDue.toISOString();
                      }
                  }
              }

              return { 
                ...item, 
                content: newContent,
                status: newStatus,
                completed_at: completedAt,
                meta: { 
                    ...item.meta, 
                    tags: newTags, 
                    amount: newAmount, 
                    date: finalDate,
                    paymentMethod: newPaymentMethod,
                    budgetCategory: newBudgetCategory,
                    durationMinutes: newDuration,
                    skillId: newSkillId,
                    toWallet: newToWallet,
                    financeType: newFinanceType || item.meta.financeType,
                    progress: newProgress,
                    progressNotes: newProgressNotes,
                    shoppingCategory: newShoppingCategory || item.meta.shoppingCategory,
                    recurrenceDays: newRecurrenceDays !== undefined ? newRecurrenceDays : item.meta.recurrenceDays,
                    quantity: newQuantity !== undefined ? newQuantity : item.meta.quantity,
                    isRoutine: newIsRoutine !== undefined ? newIsRoutine : item.meta.isRoutine,
                    routineInterval: newRoutineInterval || item.meta.routineInterval,
                    routineDaysOfWeek: newRoutineDaysOfWeek || item.meta.routineDaysOfWeek,
                    routineDaysOfMonth: newRoutineDaysOfMonth || item.meta.routineDaysOfMonth,
                    routineMonthsOfYear: newRoutineMonthsOfYear || item.meta.routineMonthsOfYear,
                    savingGoalId: newSavingGoalId || item.meta.savingGoalId,
                    dedicatedWalletId: newDedicatedWalletId || item.meta.dedicatedWalletId
                } 
              };
          });
          setItems(updatedItems);
          saveAndSync(updatedItems);
    };

    const handleAddTask = async (content: string, date: string) => {
        const newItem: BrainDumpItem = {
            id: uuidv4(),
            type: ItemType.TODO,
            content,
            status: 'pending',
            created_at: new Date().toISOString(),
            meta: {
                tags: [],
                date: date
            }
        };

        const updated = [newItem, ...itemsRef.current];
        setItems(updated);
        saveAndSync(updated);
    };

    const handleAddShoppingItem = async (
        content: string, 
        category: ShoppingCategory,
        quantity?: string,
        amount?: number,
        budgetCategory?: string,
        date?: string,
        routineInterval?: 'daily' | 'weekly' | 'monthly' | 'yearly',
        routineDaysOfWeek?: number[],
        routineDaysOfMonth?: number[],
        routineMonthsOfYear?: number[],
        dedicatedWalletId?: string
    ) => {
        const newItem: BrainDumpItem = {
            id: uuidv4(),
            type: ItemType.SHOPPING,
            content,
            status: 'pending',
            created_at: new Date().toISOString(),
            meta: {
                tags: [],
                shoppingCategory: category,
                quantity,
                amount,
                budgetCategory,
                date: date || new Date().toISOString(),
                isRoutine: category === 'routine',
                routineInterval: category === 'routine' ? routineInterval : undefined,
                routineDaysOfWeek: category === 'routine' ? routineDaysOfWeek : undefined,
                routineDaysOfMonth: category === 'routine' ? routineDaysOfMonth : undefined,
                routineMonthsOfYear: category === 'routine' ? routineMonthsOfYear : undefined,
                dedicatedWalletId: category === 'saving' ? dedicatedWalletId : undefined
            }
        };

        const updated = [newItem, ...itemsRef.current];
        setItems(updated);
        saveAndSync(updated);
    };

    const handleAddSavingTransaction = (amount: number, walletId: string, date: string, goalId: string, goalName: string) => {
        const newFinanceItem: BrainDumpItem = {
            id: uuidv4(),
            type: ItemType.FINANCE,
            content: `Saved for: ${goalName}`,
            status: 'done',
            created_at: new Date().toISOString(),
            completed_at: new Date(date).toISOString(),
            meta: {
                tags: [],
                amount,
                paymentMethod: walletId,
                financeType: 'saving',
                savingGoalId: goalId
            }
        };

        const updated = [newFinanceItem, ...itemsRef.current];
        setItems(updated);
        saveAndSync(updated);
    };

    const handleAddTransaction = async (
        content: string,
        amount: number,
        type: FinanceType,
        paymentMethod?: string,
        budgetCategory?: string,
        toWallet?: string,
        date?: string
    ) => {
        const newItem: BrainDumpItem = {
            id: uuidv4(),
            type: ItemType.FINANCE,
            content,
            status: 'done',
            created_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            meta: {
                tags: [],
                amount,
                financeType: type,
                paymentMethod,
                budgetCategory,
                toWallet,
                date: date || new Date().toISOString()
            }
        };

        const updated = [newItem, ...itemsRef.current];
        setItems(updated);
        saveAndSync(updated);
    };

    const handleAddNote = async (content: string, tags: string[]) => {
        const newItem: BrainDumpItem = {
            id: uuidv4(),
            type: ItemType.NOTE,
            content,
            status: 'pending',
            created_at: new Date().toISOString(),
            meta: {
                tags: tags
            }
        };

        const updated = [newItem, ...itemsRef.current];
        setItems(updated);
        saveAndSync(updated);
    };

    return {
        items,
        budgetConfig,
        setBudgetConfig,
        skills,
        setSkills,
        wallets,
        setWallets,
        customPrompt,
        setCustomPrompt,
        monthlyThemes,
        setMonthlyThemes,
        appSettings,
        setAppSettings,
        loading,
        error,
        pendingCount,
        syncStatus,
        loadData,
        saveAndSync,
        handleSend,
        handleToggleStatus,
        handleDelete,
        handleUpdateItem,
        handleAddRoutineTask,
        handleAddTask,
        handleAddShoppingItem,
        handleAddSavingTransaction,
        handleResetRoutine,
        handleAddTransaction,
        handleAddNote
    };
};