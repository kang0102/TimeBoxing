# Frozen momentum weight study v1

Fit once on 2026-09-21 UTC. This is a bounded comparison of 11 ranking weight vectors, not asset allocation training or a claim of global optimality. Entry, next-open execution, exits, costs and the five-position cap remain fixed. The original strategy file and published rotation score are unchanged.

For each market and 5/10/20/60 trading-day maximum holding period, select weights using three non-overlapping training segments. Require at least 30 non-forced training trades in total and five per segment. Rank candidates by the median of annualized return minus the chosen penalty times absolute maximum drawdown. Ties keep the earlier candidate, with baseline first. Validation metrics never enter the selection function.

The baseline here uses the original 35/20/20/15/10 score for ranking. The older rotation backtest ranks by RS20, so its returns are not the comparator for this experiment.

Historical validation dates were recorded at the first fit and are frozen in `weight_model.json`. Adding `validation_end` immediately after fitting was a metadata correction to prevent later weekly reports from pooling new observations into the old holdout; it did not change weights, objective scores or historical results. Data starting 2026-09-22 is evaluated separately. The weekly job evaluates this frozen model without `--fit`; it refuses changed search configuration and will not overwrite a fitted model. Re-training requires a separately versioned research design and written reason.

Initial results did not establish improvement over the baseline. All candidates remain unapplied. The historical list has hindsight selection/survivorship bias; the benchmark period had been viewed previously. Trades may be correlated, and period-end forced liquidations are explicitly counted. Monthly/yearly personal plans, manual news waves, institutional/ETF evidence and the personal sell/hold rules were not trained or validated by this study.

The job uses Python and public data in GitHub Actions; it does not invoke an LLM or require an OpenAI API key. Firebase stores authenticated private plans. The browser evaluates simple deterministic conditions against the public daily snapshot.
