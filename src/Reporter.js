(function() {
    'use strict';

    let type = require('ee-types');
    let log = require('ee-log');
    let config = require('../config.js');
    let GitHub = require('github');
    let Harvest = require('harvest');
    let Row = require('./Row');


    

    module.exports = class Reporter {


        constructor() {
            this.github = new GitHub({
                  version: '3.0.0'
                , protocol: 'https'
                , host: 'api.github.com'
                , timeout: 60000
                , headers: {
                    'user-agent': 'http://github.com/joinbox/github-harvest-reporting-bridge/issues'
                }
            });


            this.github.authenticate({
                  type  : "oauth"
                , token : config.authentication.github.token
            });


            this.harvest = new Harvest({
                  subdomain: config.authentication.harvest.domain
                , email: config.authentication.harvest.email
                , password:  config.authentication.harvest.password
                , user_agent: 'http://github.com/joinbox/github-harvest-reporting-bridge/issues'
            });
        }





        createReport() {
            log.info('loading data ....');
            Promise.all([
                  this.getTasks()
                , this.getReport()
                , this.getIssues()
            ]).then(() => {
                log.info('data loaded, egenrating report ....');


                // make structurized data
                this.nodeList.forEach((node) => {
                    if (this.tasks.has(node.task_id)) {
                        let task = this.tasks.get(node.task_id);
                        if (!task.nodes) task.nodes = [];
                        task.nodes.push(node);

                        // find gh issues
                        let issueId = /^\#([0-9]+):\s/gi.exec(node.notes || '');
                        if (issueId && issueId[1]) {
                            issueId = parseInt(issueId[1], 10);

                            if (this.issues.has(issueId)) {
                                let issue = this.issues.get(issueId);
                                node.issue = issue;

                                // mark as used
                                node.issue.consumed = true;
                            }
                        }
                    }
                    else throw new Error('Unknown task!');
                });


                // create rows for the report
                let report = [];


                this.tasksList.forEach((task) => {
                    if (task.nodes && task.nodes.length) {
                        task.nodes.forEach((node) => {
                            report.push(new Row({
                                  task: task.name
                                , estimate: task.estimate
                                , date: new Date(node.created_at)
                                , userId: node.user_id
                                , hours: node.hours
                                , issueId: node.issue ? node.issue.number : null
                                , projectedHours: node.issue ? node.issue.projectedTime : null
                                , planned: node.issue ? node.issue.projectedTime : null
                            }));
                        });
                    }
                    else {
                        report.push(new Row({
                              task: task.name
                            , estimate: task.estimate
                        }));
                    }
                });


                // add issues that were not added before and can be matched with a milestone
                this.issueList.forEach((issue) => {
                    if (!issue.consumed && issue.milestone && this.taskNameMap.has(issue.milestone.title)) {

                        let task = this.taskNameMap.get(issue.milestone.title);
                        let unplanned = issue.labels.some((label) => label.name ==='unplanned');

                        report.push(new Row({
                              task: task.name
                            , estimate: task.estimate
                            , issueId: issue.number
                            , projectedHours: issue ? issue.projectedTime : null
                            , planned: !unplanned
                        }));
                    }
                });


                /*report.sort((a, b) => {
                    if (a.data.task == b.data.task) return a.data.date > b.data.date;
                    else return a.data.task >= b.data.task;
                });*/


                log.success('report created ....');

                console.log(['task', 'estimate', 'userId', 'hours', 'issueId', 'projectedHours', 'planned', 'year', 'month', 'date'].map(t => `"${t}"`).join(', '));
                console.log(report.map(row => row.format()).join('\n'));
            }).catch(log);
        }






        getTasks() {
            return new Promise((resolve, reject) => {
                log.debug('getting harvest tasks ....');

                this.harvest.TaskAssignment.listByProject({
                    project_id: config.harvest.projectId
                }, (err, assignements) => {
                    if (err) reject(err);
                    else {
                        let assignementMap = new Map();
                        assignements.forEach(a => assignementMap.set(a.task_assignment.task_id, a.task_assignment));

                        this.harvest.Tasks.list(null, (err, data) => {
                            if (err) reject(err);
                            else {
                                this.tasksList = data.map(task => task.task).filter(task => assignementMap.has(task.id));
                                this.tasks = new Map();
                                this.taskNameMap = new Map();

                                this.tasksList.forEach((task) => {
                                    task.estimate = assignementMap.get(task.id).estimate;
                                    this.tasks.set(task.id, task);
                                    this.taskNameMap.set(task.name, task);
                                });

                                log.success('harvest tasks loaded ...');
                                resolve();
                            }
                        });
                    }
                });                
            });
        }





        getReport() {
            return new Promise((resolve, reject) => {
                log.debug('getting harvest nodes ....');
                this.harvest.Reports.timeEntriesByProject({
                      project_id: config.harvest.projectId
                    , from: config.harvest.from || '20000101'
                    , to: config.harvest.to || '20990101'
                }, (err, data) => {
                    if (err) reject(err);
                    else {
                        this.nodeList = data.map(node => node.day_entry);
                        this.nodes = new Map();

                        this.nodeList.forEach((node) => {
                            this.nodes.set(node.id, node);
                        });


                        log.success('harvest nodes loaded ...');
                        resolve();
                    }
                });
            });
        }





        getIssues(page) {
            page = page || 1;
            if (!this.issueList) this.issueList = [];

            return new Promise((resolve, reject) => {
                log.debug('getting github issues ....');
                this.github.issues.repoIssues({
                      user: config.github.user
                    , repo: config.github.repository
                    , state: 'all'
                    , page: page
                    , per_page: 100
                }, (err, data) => {
                    if (err) reject(err);
                    else {
                        this.issueList = this.issueList.concat(data);

                        if (data.meta && data.meta.link && /rel="next"/gi.test(data.meta.link)) {
                            log.debug('getting next github issues page....');
                            this.getIssues(page+1).then(resolve).catch(reject);
                        } else {

                            // need a mpa
                            this.issues = new Map();

                            this.issueList.forEach((issue) => {
                                config.github.timeRegex.lastIndex = 0;

                                let time = config.github.timeRegex.exec(issue.title);
                                issue.projectedTime = time && time[1] ? parseFloat(time[1])*config.github.timeMultiplier : null;

                                this.issues.set(issue.number, issue);
                            });


                            log.success('github issues loaded ...');
                            resolve();
                        }
                    }
                });
            });
        }
    };
})();
