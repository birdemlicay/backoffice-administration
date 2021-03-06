'use strict';

/**
 * Module dependencies.
 */
var path = require('path'),
    errorHandler = require(path.resolve('./modules/core/server/controllers/errors.server.controller')),
    db = require(path.resolve('./config/lib/sequelize')).models,
    sequelizes =  require(path.resolve('./config/lib/sequelize')),
    dateFormat = require('dateformat'),
    moment = require('moment'),
    async = require('async'),
    DBModel = db.salesreport;

/**
 * Create
 */
exports.create = function(req, res) {

    DBModel.create(req.body).then(function(result) {
        if (!result) {
            return res.status(400).send({message: 'fail create data'});
        }
        else {
            return res.jsonp(result);
        }
    }).catch(function(err) {
        return res.status(400).send({ message: errorHandler.getErrorMessage(err) });
    });
};

/**
 * Show current
 */
exports.read = function(req, res) {
    res.json(req.salesReport);
};

/**
 * Update
 */
exports.update = function(req, res) {
    var updateData = req.salesReport;

    updateData.updateAttributes(req.body).then(function(result) {
        res.json(result);
    }).catch(function(err) {
        return res.status(400).send({ message: errorHandler.getErrorMessage(err) });
    });

};

exports.annul = function(req, res) {
    var response = {};
    var username = (req.body.username) ? req.body.username : '';
    var duration = 0;

    if(req.body.login_id && req.body.combo_id){
        var salereport_where = {combo_id: req.body.combo_id, login_data_id: req.body.login_id,active: true};
    }
    else if(req.body.sale_id){
        var sale_id = (req.body.sale_id);
        var salereport_where = {id: sale_id, active: true};
    }
    else {
        return res.status(400).send({ message: 'No sale with these data exists' });
    }

    async.auto({
        get_active_sale: function(callback) {
            db.salesreport.findOne({
                attributes: ['id', 'combo_id', 'login_data_id'],
                where: salereport_where
            }).then(function(active_sale){
                if(active_sale.length<1){
                    response = {status: 400, message: 'Sale is not active'}
                    callback(true, response);
                }
                else{
                    callback(null, active_sale);
                }
                return null;
            }).catch(function(error){
                response = {status: 400, message: 'Sale cannot be canceled'}
                callback(true, response);
            });
        },
        get_user_subscription: ['get_active_sale', function(results, callback) {
            db.combo.findAll({
                attributes: ['id', 'duration'], where: {id: results.get_active_sale.combo_id}, raw: true,
                include:[{
                    model: db.combo_packages, required: true, attributes: ['package_id'], include: [{
                        model: db.package, required: true, attributes: ['id'], include: [{
                            model: db.subscription, required: false, attributes: ['id', 'start_date', 'end_date'], where: {login_id: results.get_active_sale.login_data_id}
                        }]
                    }]
                }]
            }).then(function(current_subscription){
                if(current_subscription.length < 1){
                    response = {status: 400, message: 'Sale did not contain any package to be canceled'}
                    callback(true, response);
                }
                else{
                    duration = (req.body.duration) ? req.body.duration : current_subscription[0].duration; //if a specific duration is given, remove those days from subscription. otherwise remove combo duration
                    callback(null, current_subscription);
                }
                return null;
            }).catch(function(error){
                response = {status: 400, message: 'Could not proceed with annulment'};
                callback(true, response);
            });
        }],
        update_subscription: ['get_user_subscription', 'get_active_sale', function(results, callback) {
            var updated = 0;
            for(var i = 0; i < results.get_user_subscription.length; i++) {
                var startdate = results.get_user_subscription[i]['combo_packages.package.subscriptions.start_date'];
                var enddate = moment(results.get_user_subscription[i]['combo_packages.package.subscriptions.end_date'], 'YYYY-MM-DD hh:mm:ss').subtract(duration, 'day');
                db.subscription.update(
                    {
                        login_id:            results.get_active_sale.login_data_id,
                        package_id:          results.get_user_subscription[i]['combo_packages.package_id'],
                        customer_username:   username,
                        user_username:       '',
                        start_date:          startdate,
                        end_date:            enddate
                    },
                    {where: {id: results.get_user_subscription[i]['combo_packages.package.subscriptions.id']}}
                ).then(function(result){
                    if (++updated == results.get_user_subscription.length) {
                        callback(null);
                    }
                    return null;
                }).catch(function(error){
                    response = {status: 400, message: 'Some packages could not be canceled'};
                    callback(null, response);
                    return;
                });
            }
        }],
        deactivate_sale: ['get_user_subscription', 'get_active_sale', 'update_subscription', function(results, callback) {
            db.salesreport.update(
                {
                    user_id:            1,
                    combo_id:           results.get_active_sale.combo_id,
                    login_data_id:      results.get_active_sale.login_data_id,
                    user_username:      username,
                    distributorname:    '',
                    saledate:           dateFormat(Date.now(), 'yyyy-mm-dd HH:MM:ss'),
                    active:             false
                },
                {where: {id: results.get_active_sale.id}}
            ).then(function(result){
                response = {status: 200, message: 'Sale annuled successfully'};
                callback(null);
                return null;
            }).catch(function(error){
                response = {status: 400, message: 'Subscription canceled, could not annul sale record'}
                callback(true, response);
            });
        }]
    }, function(err, results) {
        if(err) {
            return res.status(400).send({
                message: 'Unable to annul this sale'
            });
        }
        else return res.status(response.status).send({ message: response.message });
    });


};

/**
 * Delete
 */
exports.delete = function(req, res) {
    DBModel.destroy({
        where: {
            combo_id: req.body.combo_id,
            login_data_id: req.body.login_data_id
        }
    }).then(function (result) {
        if(!result){
            return res.status(400).send({
                message: 'Unable to annul this sale'
            });
        }
        else{
            db.subscriptions.update({
                where: {
                    combo_id: req.body.combo_id,
                    login_data_id: req.body.login_data_id
                }
            }).then(function (result) {
                if(!result){
                    return res.status(400).send({
                        message: 'Unable to annul this sale'
                    });
                }
                else{

                }
            }).catch(function(error) {
                return res.status(400).send({
                    message: 'Unable to annul this sale'
                });
            });
        }
    }).catch(function(error) {
        return res.status(400).send({
            message: 'Unable to annul this sale'
        });
    });

    DBModel.destroy(

    ).then(function(result) {
        if (result) {
            result.destroy().then(function() {
                return res.json(result);
            }).catch(function(err) {
                return res.status(400).send({ message: errorHandler.getErrorMessage(err) });
            });
        } else {
            return res.status(400).send({
                message: 'Unable to find the Data'
            });
        }
    }).catch(function(err) {
        return res.status(400).send({ message: errorHandler.getErrorMessage(err) });
    });
};

/**
 * List
 */
exports.list = function(req, res) {
    //if a filter is left empty, query searches for like '%%' in case of strings and interval [0 - 3000] years for dates, ignoring the filter
    var qwhere = {},
        final_where = {},
        query = req.query;
    final_where.where = qwhere; //start building where

    if(req.query.user_username) final_where.where.user_username = {like: '%'+req.query.user_username+'%'};
    if(query.login_data_id) final_where.where.login_data_id = query.login_data_id;
    if(req.query.distributorname) final_where.where.distributorname = {like: '%'+req.query.distributorname+'%'};
    if(req.query.name) final_where.where.combo_id = req.query.name;

    if(req.query.active === 'active') final_where.where.active = true;
    if(req.query.active === 'cancelled') final_where.where.active = false;

    if(req.query.startsaledate) final_where.where.saledate = {gte:req.query.startsaledate};
    if(req.query.endsaledate) final_where.where.saledate = {lte:req.query.endsaledate};

    if((req.query.startsaledate) && (req.query.endsaledate)) final_where.where.saledate = {gte:req.query.startsaledate,lte:req.query.endsaledate};

    //fetch records for specified page
    if(parseInt(query._start)) final_where.offset = parseInt(query._start);
    if(parseInt(query._end)) final_where.limit = parseInt(query._end)-parseInt(query._start);

    if(query._orderBy) final_where.order = query._orderBy + ' ' + query._orderDir; //sort by specified field and specified order

    final_where.include = [
        {model: db.combo, required: true, attributes: ['name']},
        {model: db.users, required: true, attributes: ['username']}
    ]

    DBModel.findAndCountAll(
        final_where
    ).then(function(results) {
        if (!results) {
            return res.status(404).send({ message: 'No data found' });
        } else {
            res.setHeader("X-Total-Count", results.count);
            res.json(results.rows);
        }
    }).catch(function(err) {
        res.jsonp(err);
    });

};

exports.sales_by_product = function(req, res) {
    var qwhere = {},
        final_where = {},
        query = req.query;
    final_where.where = qwhere; //start building where

    if(req.query.name) final_where.where.combo_id = req.query.name;
    if(req.query.active === 'active') final_where.where.active = true;
    if(req.query.active === 'cancelled') final_where.where.active = false;

    if(req.query.startsaledate) final_where.where.saledate = {gte:req.query.startsaledate};
    if(req.query.endsaledate) final_where.where.saledate = {lte:req.query.endsaledate};

    if((req.query.startsaledate) && (req.query.endsaledate)) final_where.where.saledate = {gte:req.query.startsaledate,lte:req.query.endsaledate};

    //fetch records for specified page
    if(parseInt(query._start)) final_where.offset = parseInt(query._start);
    if(parseInt(query._end)) final_where.limit = parseInt(query._end)-parseInt(query._start);

    if(query._orderBy) final_where.order = query._orderBy + ' ' + query._orderDir; //sort by specified field and specified order

    final_where.attributes = ['id', 'combo_id', [sequelize.fn('max', sequelize.col('saledate')), 'saledate'], 'createdAt', [sequelize.fn('count', sequelize.col('combo_id')), 'count']];
    final_where.include = [{model: db.combo, required: true, attributes: ['name', 'duration', 'value']}];
    final_where.group = ['combo_id'];


    DBModel.findAndCountAll(
        final_where
    ).then(function(results) {
        if (!results) {
            return res.status(404).send({ message: 'No data found' });
        } else {
            res.setHeader("X-Total-Count", results.count.length);
            res.json(results.rows);
        }
    }).catch(function(err) {
        res.jsonp(err);
    });

};

exports.sales_by_date = function(req, res) {
    var qwhere = {},
        final_where = {},
        query = req.query;
    final_where.where = qwhere; //start building where

    if(req.query.user_username) final_where.where.user_username = {like: '%'+req.query.user_username+'%'};
    if(query.login_data_id) final_where.where.login_data_id = query.login_data_id;
    if(req.query.distributorname) final_where.where.distributorname = {like: '%'+req.query.distributorname+'%'};
    if(req.query.active === 'active') final_where.where.active = true;
    if(req.query.active === 'cancelled') final_where.where.active = false;


    if(req.query.name) final_where.where.combo_id = req.query.name;

    if(req.query.startsaledate) final_where.where.saledate = {gte:req.query.startsaledate};
    if(req.query.endsaledate) final_where.where.saledate = {lte:req.query.endsaledate};

    if((req.query.startsaledate) && (req.query.endsaledate)) final_where.where.saledate = {gte:req.query.startsaledate,lte:req.query.endsaledate};

    //fetch records for specified page

    if(parseInt(query._start)) final_where.offset = parseInt(query._start);
    if(parseInt(query._end)) final_where.limit = parseInt(query._end)-parseInt(query._start);

    //sort by specified field and specified order, otherwise sort by sale date
    if(query._orderBy) final_where.order = query._orderBy + ' ' + query._orderDir;
    else final_where.order = [['saledate', 'DESC']];

    final_where.attributes = ['id', [sequelize.fn('DATE_FORMAT', sequelize.col('saledate'), "%Y-%m-%d"), 'saledate'], [sequelize.fn('count', sequelize.col('saledate')), 'count'], 'active'];
    final_where.group = [sequelize.fn('DATE', sequelize.col('saledate'))]; //group by date of sale (excluding time information)

    final_where.include = [{model: db.combo, required: true, attributes: [[sequelize.fn('sum', sequelize.col('value')), 'total_value']]}];

    DBModel.findAndCountAll(
        final_where
    ).then(function(results) {
        if (!results) {
            return res.status(404).send({ message: 'No data found' });
        } else {
            res.setHeader("X-Total-Count", results.count.length);
            res.json(results.rows);
        }
    }).catch(function(err) {
        res.jsonp(err);
    });

};

exports.sales_by_month = function(req, res) {
    var qwhere = {},
        final_where = {},
        query = req.query;
    final_where.where = qwhere; //start building where

    if(req.query.user_username) final_where.where.user_username = {like: '%'+req.query.user_username+'%'};
    if(query.login_data_id) final_where.where.login_data_id = query.login_data_id;
    if(req.query.distributorname) final_where.where.distributorname = {like: '%'+req.query.distributorname+'%'};

    if(req.query.active === 'active') final_where.where.active = true;
    if(req.query.active === 'cancelled') final_where.where.active = false;

    if(req.query.name) final_where.where.combo_id = req.query.name;

    if(req.query.startsaledate) final_where.where.saledate = {gte:req.query.startsaledate};
    if(req.query.endsaledate) final_where.where.saledate = {lte:req.query.endsaledate};

    if((req.query.startsaledate) && (req.query.endsaledate)) final_where.where.saledate = {gte:req.query.startsaledate,lte:req.query.endsaledate};

    //fetch records for specified page
    if(parseInt(query._start)) final_where.offset = parseInt(query._start);
    if(parseInt(query._end)) final_where.limit = parseInt(query._end)-parseInt(query._start);

    if(query._orderBy) final_where.order = query._orderBy + ' ' + query._orderDir; //sort by specified field and specified order

    final_where.attributes = ['id', 'saledate', [sequelize.fn('count', sequelize.col('saledate')), 'count']];
    final_where.group = [sequelize.fn('DATE_FORMAT', sequelize.col('saledate'), "%Y-%m-01")]; //group by month/year of sale (excluding day and time information)

    final_where.include = [{model: db.combo, required: true, attributes: [[sequelize.fn('sum', sequelize.col('value')), 'total_value']]}];

    DBModel.findAndCountAll(
        final_where
    ).then(function(results) {
        if (!results) {
            return res.status(404).send({ message: 'No data found' });
        } else {
            res.setHeader("X-Total-Count", results.count.length);
            res.json(results.rows);
        }
    }).catch(function(err) {
        res.jsonp(err);
    });

};

exports.sales_monthly_expiration = function(req, res) {

    var thequery = "SELECT count(subscription_sub.login_id), subscription_sub.enddate "+
        " from ( " +
        " SELECT `login_id`, DATE_FORMAT(max(`end_date`), '%Y-%m') AS `enddate`  " +
        " FROM `subscription` AS `subscription` "+
        " GROUP BY `login_id` "+
        " ORDER BY `subscription`.`end_date` DESC "+
        " ) as subscription_sub "+
        " group by enddate "+
        " Order by enddate desc; ";


    sequelizes.sequelize.query(thequery)
        .then(function(result) {
            res.send(result)
        }).catch(function(err) {
        res.jsonp(err);
    });

};


exports.sales_by_expiration = function(req, res) {
    var qwhere = {},
        final_where = {},
        query = req.query;
    final_where.where = qwhere; //start building where

    if(req.query.login_id) final_where.where.login_id = {like: '%'+req.query.login_id+'%'};
    if(query.login_data_id) final_where.where.login_data_id = query.login_data_id;
    if(req.query.distributorname) final_where.where.distributorname = {like: '%'+req.query.distributorname+'%'};

    if(req.query.name) final_where.where.combo_id = req.query.name;

    var start = (req.query.startsaledate) ? (req.query.startsaledate+' 00:00:00') : sequelize.literal('CURDATE()');
    if(req.query.next) var end = sequelize.literal('CURDATE() + INTERVAL '+req.query.next+' DAY');
    else if(req.query.endsaledate) var end = req.query.endsaledate;
    final_where.where = (end) ? {end_date: {between: [start, end]}} : {end_date: {gte: start}};

    if(parseInt(query._start)) final_where.offset = parseInt(query._start);
    if(parseInt(query._end)) final_where.limit = parseInt(query._end)-parseInt(query._start);

    final_where.attributes = ['id', 'login_id', [sequelize.fn('max', sequelize.col('end_date')), 'end_date']];
    final_where.group = ['login_id'];
    final_where.order = [['end_date', 'DESC']];

    db.subscription.findAndCountAll(
        final_where
    ).then(function(results) {
        if (!results) {
            return res.status(404).send({ message: 'No data found' });
        } else {
            res.setHeader("X-Total-Count", results.count.length);
            res.json(results.rows);
        }
    }).catch(function(err) {
        res.jsonp(err);
    });

};

/**
 * Lastest
 */
exports.latest = function(req, res) {

    DBModel.findAndCountAll({
        offset: offset_start,
        limit: records_limit,
        include: [db.combo, db.users],
        order: [['createdAt','ASC']]
    }).then(function(results) {
        if (!results) {
            return res.status(404).send({ message: 'No data found' });
        } else {
            res.setHeader("X-Total-Count", results.count);
            res.json(results.rows);
        }
    }).catch(function(err) {
        res.jsonp(err);
    });
};

/**
 * middleware
 */

exports.dataByID = function(req, res, next, id) {

    if ((id % 1 === 0) === false) { //check if it's integer
        return res.status(404).send({
            message: 'Data is invalid'
        });
    }

    DBModel.find({
        where: { id: id },
        include: [{model: db.combo}, {model: db.users}]
    }).then(function(result) {
        if (!result) {
            return res.status(404).send({
                message: 'No data with that identifier has been found'
            });
        } else {
            req.salesReport = result;
            next();
        }
    }).catch(function(err) {
        return next(err);
    });

};