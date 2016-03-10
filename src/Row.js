(function() {
    'use strict';

    let type = require('ee-types');
    let log = require('ee-log');


    

    module.exports = class Reporter {


        constructor(data) {
            this.data = data;
        }





        prettyFormat(item) {

        }



        format() {
            return ['task', 'estimate', 'userId', 'hours', 'issueId', 'projectedHours', 'planned', 'date'].map((key) => {
                let item = this.data[key];

                if (!type.undefined(item)) {
                    if (type.date(item)) return `"${item.getFullYear()}", "${item.getMonth()+1}", "${item.getDate()}"`;
                    else if (type.null(item)) return '""';
                    else return `"${item}"`;
                } else return '""' ;
            }).join(', ');
        }
    };
})();
